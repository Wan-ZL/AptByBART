/**
 * Crime ingestion orchestrator
 * Runs all ingesters, writes observations to DB, computes safety scores.
 */

import { db } from '../../db/client';
import type { CrimeIngester, CrimeObservation, CrimeCategory } from '../../lib/crime-taxonomy';
import { DEFAULT_WEIGHTS } from '../../lib/crime-taxonomy';
import {
  computeSafetyScores,
  computeTractEnsembleScores,
  type AreaCrimeCounts,
} from '../../lib/safety-scoring';
import { STATION_CITY } from './ca-doj';
import { runAllocator } from './allocate';
import { childLogger } from '../../lib/logger';

const log = childLogger('ingest:orchestrator');

export async function runIngestion(ingesters: CrimeIngester[]): Promise<void> {
  const allObservations: CrimeObservation[] = [];

  // --- Step 1: Register data sources ---
  log.info({ sourceCount: ingesters.length }, 'registering data sources');
  for (const ing of ingesters) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO crime_data_sources (id, name, api_type, granularity, update_frequency, status)
            VALUES (?, ?, ?, ?, ?, 'active')`,
      args: [ing.sourceId, ing.sourceName, ing.apiType, ing.granularity, ing.updateFrequency],
    });
  }

  // --- Step 2: Run each ingester ---
  for (const ing of ingesters) {
    log.info({ sourceId: ing.sourceId, sourceName: ing.sourceName }, 'ingester start');
    const startMs = Date.now();

    try {
      const observations = await ing.fetch();
      const durationMs = Date.now() - startMs;
      log.info(
        {
          sourceId: ing.sourceId,
          durationMs,
          rowCount: observations.length,
        },
        'ingester success'
      );

      allObservations.push(...observations);

      // Update source metadata
      await db.execute({
        sql: `UPDATE crime_data_sources
              SET last_fetched_at = datetime('now'), last_success_at = datetime('now'), record_count = ?
              WHERE id = ?`,
        args: [observations.length, ing.sourceId],
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      log.error(
        { sourceId: ing.sourceId, durationMs, err },
        'ingester failed'
      );

      await db.execute({
        sql: `UPDATE crime_data_sources SET last_fetched_at = datetime('now') WHERE id = ?`,
        args: [ing.sourceId],
      });
    }
  }

  if (allObservations.length === 0) {
    log.warn('no observations collected — skipping DB write');
    return;
  }

  // --- Step 3: Ensure geo_areas exist ---
  // Sub-city areas (beats, neighborhoods) need an explicit parent city since the
  // geo_area_id alone ("beat:25X", "neighborhood:mission") carries no location
  // hierarchy. Root-level areas (city/county/state) derive their parent from the
  // id prefix: city→county(source-specific), county→state:california, state→NULL.
  const SOURCE_DEFAULT_PARENT: Record<string, string | null> = {
    oakland: 'city:oakland',
    datasf: 'city:san_francisco',
    santa_clara: null,
    marin: null,
    ca_doj: null,
    fbi: null,
    sjpd: 'city:san_jose',
    berkeley: 'city:berkeley',
    alameda_sheriff: 'county:alameda',
    sunnyvale: 'city:sunnyvale',
    palo_alto: 'city:palo_alto',
    richmond: 'city:richmond',
    mountain_view: 'city:mountain_view',
    fremont: 'city:fremont',
    hayward: 'city:hayward',
    'walnut-creek': 'city:walnut_creek',
    concord: 'city:concord',
  };

  // Cities → county mapping for parent resolution. Used only when auto-creating
  // a geo_area that the hierarchy-fixer seed hasn't already inserted.
  const CITY_COUNTY: Record<string, string> = {
    // San Francisco County
    san_francisco: 'county:san_francisco',
    // Alameda County
    oakland: 'county:alameda', berkeley: 'county:alameda', alameda: 'county:alameda',
    fremont: 'county:alameda', hayward: 'county:alameda', livermore: 'county:alameda',
    pleasanton: 'county:alameda', san_leandro: 'county:alameda', dublin: 'county:alameda',
    union_city: 'county:alameda', emeryville: 'county:alameda', newark: 'county:alameda',
    albany: 'county:alameda', piedmont: 'county:alameda',
    // Contra Costa County
    concord: 'county:contra_costa', richmond: 'county:contra_costa',
    walnut_creek: 'county:contra_costa', antioch: 'county:contra_costa',
    pittsburg: 'county:contra_costa', pleasant_hill: 'county:contra_costa',
    orinda: 'county:contra_costa', lafayette: 'county:contra_costa',
    el_cerrito: 'county:contra_costa',
    // San Mateo County
    daly_city: 'county:san_mateo', south_san_francisco: 'county:san_mateo',
    san_bruno: 'county:san_mateo', millbrae: 'county:san_mateo',
    redwood_city: 'county:san_mateo', san_mateo: 'county:san_mateo',
    east_palo_alto: 'county:san_mateo',
    // Santa Clara County
    san_jose: 'county:santa_clara', palo_alto: 'county:santa_clara',
    mountain_view: 'county:santa_clara', santa_clara: 'county:santa_clara',
    sunnyvale: 'county:santa_clara', milpitas: 'county:santa_clara',
    cupertino: 'county:santa_clara',
    // Marin County
    san_rafael: 'county:marin',
    // Napa County
    napa: 'county:napa',
    // Solano County
    fairfield: 'county:solano', vallejo: 'county:solano',
  };

  function derivedParent(areaId: string, sourceId: string): string | null {
    const [areaType, ...rest] = areaId.split(':');
    const slug = rest.join(':');
    if (areaType === 'state') return null;
    if (areaType === 'county') return 'state:california';
    if (areaType === 'city') {
      return CITY_COUNTY[slug] ?? null;
    }
    // Sub-city (tract, neighborhood, beat): use source-specific default.
    if (sourceId in SOURCE_DEFAULT_PARENT) return SOURCE_DEFAULT_PARENT[sourceId];
    return null;
  }

  log.info({ observationCount: allObservations.length }, 'ensuring geo_areas');
  const areaToSource = new Map<string, string>();
  for (const o of allObservations) {
    if (!areaToSource.has(o.geoAreaId)) areaToSource.set(o.geoAreaId, o.sourceId);
  }
  const uniqueAreas = new Set(allObservations.map(o => o.geoAreaId));
  const geoAreaStmts = [...uniqueAreas].map(areaId => {
    const [areaType, ...rest] = areaId.split(':');
    const slug = rest.join(':');
    const name = slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const sourceId = areaToSource.get(areaId)!;
    const parentAreaId = derivedParent(areaId, sourceId);
    if (parentAreaId === null && areaType !== 'state') {
      log.warn({ areaId, sourceId }, 'no derivable parent — creating with NULL parent');
    }
    return {
      sql: `INSERT OR IGNORE INTO geo_areas (id, name, area_type, parent_area_id) VALUES (?, ?, ?, ?)`,
      args: [areaId, name, areaType, parentAreaId],
    };
  });
  if (geoAreaStmts.length > 0) {
    await db.batch(geoAreaStmts, 'write');
    log.info({ count: geoAreaStmts.length }, 'ensured geo_areas');
  }

  // --- Step 4: Bulk insert observations ---
  log.info('writing crime_observations');
  // Batch in chunks to avoid SQLite limits
  const CHUNK_SIZE = 200;
  let written = 0;
  for (let i = 0; i < allObservations.length; i += CHUNK_SIZE) {
    const chunk = allObservations.slice(i, i + CHUNK_SIZE);
    const stmts = chunk.map(o => ({
      sql: `INSERT OR REPLACE INTO crime_observations
            (source_id, geo_area_id, period_start, period_end, category, incident_count, raw_category, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [o.sourceId, o.geoAreaId, o.periodStart, o.periodEnd, o.category, o.incidentCount, o.rawCategory ?? null],
    }));
    await db.batch(stmts, 'write');
    written += chunk.length;
  }
  log.info({ written }, 'wrote crime_observations');

  // --- Step 4b: Equal-weight ensemble allocation ---
  // Allocator emits one crime_observations row per (tract, source, category, period) for
  // every source's coverage; no synthetic 'allocated_*' sources are written anymore.
  await runAllocator(db);

  // --- Step 5: Aggregate and compute safety scores ---
  log.info('computing safety scores');
  const areaCountsMap = new Map<string, AreaCrimeCounts>();

  // Fetch population data for all geo_areas
  const popResult = await db.execute('SELECT id, population FROM geo_areas WHERE population IS NOT NULL');
  const populationMap = new Map<string, number>();
  for (const row of popResult.rows) {
    populationMap.set(row.id as string, row.population as number);
  }
  log.info({ populatedAreas: populationMap.size }, 'loaded population data');

  const obsAllRes = await db.execute(
    `SELECT source_id, geo_area_id, category, incident_count
     FROM crime_observations`
  );
  type DbObs = {
    sourceId: string;
    geoAreaId: string;
    category: CrimeCategory;
    incidentCount: number;
  };
  const allObsDb: DbObs[] = obsAllRes.rows.map(r => ({
    sourceId: r.source_id as string,
    geoAreaId: r.geo_area_id as string,
    category: r.category as CrimeCategory,
    incidentCount: Number(r.incident_count ?? 0),
  }));

  const perSourceData = new Map<string, Map<string, AreaCrimeCounts>>();

  for (const obs of allObsDb) {
    // Aggregate totals (for DB storage and backward compat)
    let counts = areaCountsMap.get(obs.geoAreaId);
    if (!counts) {
      counts = { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 };
      areaCountsMap.set(obs.geoAreaId, counts);
    }
    switch (obs.category) {
      case 'violent': counts.violent += obs.incidentCount; break;
      case 'property': counts.property += obs.incidentCount; break;
      case 'vehicle': counts.vehicle += obs.incidentCount; break;
      case 'quality_of_life': counts.qualityOfLife += obs.incidentCount; break;
    }

    // Per-source counts
    if (!perSourceData.has(obs.sourceId)) {
      perSourceData.set(obs.sourceId, new Map());
    }
    const sourceMap = perSourceData.get(obs.sourceId)!;
    let srcCounts = sourceMap.get(obs.geoAreaId);
    if (!srcCounts) {
      srcCounts = { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 };
      sourceMap.set(obs.geoAreaId, srcCounts);
    }
    switch (obs.category) {
      case 'violent': srcCounts.violent += obs.incidentCount; break;
      case 'property': srcCounts.property += obs.incidentCount; break;
      case 'vehicle': srcCounts.vehicle += obs.incidentCount; break;
      case 'quality_of_life': srcCounts.qualityOfLife += obs.incidentCount; break;
    }
  }

  // Attach population data to area counts
  for (const [areaId, counts] of areaCountsMap) {
    const pop = populationMap.get(areaId);
    if (pop) counts.population = pop;
  }

  // Attach population data to per-source area counts
  for (const [, sourceMap] of perSourceData) {
    for (const [areaId, counts] of sourceMap) {
      const pop = populationMap.get(areaId);
      if (pop) counts.population = pop;
    }
  }

  log.info({ sources: perSourceData.size }, 'built per-source data');

  // --- Tract ensemble path ---
  // Per CLAUDE.md "Safety System": every tract covered by any source gets an
  // equal-weight ensemble score ∈ [0,1] (0=safest, 1=most dangerous). We strip
  // non-tract areas from per-source data and hand only tracts to the ensemble
  // scorer. Tracts are then overlaid onto the legacy score map below.
  const areaTypeRes = await db.execute(
    `SELECT id, area_type FROM geo_areas`
  );
  const areaTypeMap = new Map<string, string>();
  for (const row of areaTypeRes.rows) {
    areaTypeMap.set(row.id as string, row.area_type as string);
  }

  const perSourceTractData = new Map<string, Map<string, AreaCrimeCounts>>();
  for (const [sourceId, sourceMap] of perSourceData) {
    const tractsOnly = new Map<string, AreaCrimeCounts>();
    for (const [areaId, counts] of sourceMap) {
      if (areaTypeMap.get(areaId) === 'tract') tractsOnly.set(areaId, counts);
    }
    if (tractsOnly.size > 0) perSourceTractData.set(sourceId, tractsOnly);
  }

  const tractScores = computeTractEnsembleScores(perSourceTractData, DEFAULT_WEIGHTS);
  log.info(
    { tractSources: perSourceTractData.size, tractsScored: tractScores.size },
    'tract ensemble'
  );

  // Legacy path (non-tract areas): preserves 1-10 scale for backward compat.
  const scores = computeSafetyScores(areaCountsMap, DEFAULT_WEIGHTS, perSourceData);

  // Overlay ensemble results onto scores map for tract area_ids only.
  // Shape: { score: number ∈ [0,1], percentile: null, confidence: sourceCount }.
  for (const [tractId, { score, confidence }] of tractScores) {
    scores.set(tractId, { score, percentile: null, confidence });
  }

  // Upsert into safety_scores — skip areas with null score (no data).
  // safety_scores.score is NOT NULL; areas without data are simply absent from the table.
  const scoreStmts: Array<{ sql: string; args: any[] }> = [];
  let skippedNoData = 0;
  for (const [areaId, { score, percentile, confidence }] of scores) {
    if (score === null) {
      skippedNoData++;
      continue;
    }
    const counts = areaCountsMap.get(areaId) ?? { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 };
    const total = counts.violent + counts.property + counts.vehicle + counts.qualityOfLife;
    const sources = [...new Set(
      allObsDb.filter(o => o.geoAreaId === areaId).map(o => o.sourceId)
    )].join(',');

    const effectiveConfidence = confidence ?? null;

    scoreStmts.push({
      sql: `INSERT INTO safety_scores (geo_area_id, score, violent_count, property_count, vehicle_count, quality_of_life_count, total_incidents, sources_used, percentile_rank, confidence, computed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(geo_area_id) DO UPDATE SET
              score = excluded.score,
              violent_count = excluded.violent_count,
              property_count = excluded.property_count,
              vehicle_count = excluded.vehicle_count,
              quality_of_life_count = excluded.quality_of_life_count,
              total_incidents = excluded.total_incidents,
              sources_used = excluded.sources_used,
              percentile_rank = excluded.percentile_rank,
              confidence = excluded.confidence,
              computed_at = excluded.computed_at`,
      args: [areaId, score, counts.violent, counts.property, counts.vehicle, counts.qualityOfLife, total, sources, percentile, effectiveConfidence],
    });
  }

  for (let i = 0; i < scoreStmts.length; i += CHUNK_SIZE) {
    await db.batch(scoreStmts.slice(i, i + CHUNK_SIZE), 'write');
  }
  log.info({ scored: scoreStmts.length, skippedNoData }, 'computed safety scores');

  // Remove stale safety_scores rows for areas not scored in this run.
  const scoredAreaIds = scoreStmts.map(s => s.args[0] as string);
  const DELETE_CHUNK = 500;
  let deletedStale = 0;
  if (scoredAreaIds.length === 0) {
    const res = await db.execute(`DELETE FROM safety_scores`);
    deletedStale = Number(res.rowsAffected ?? 0);
  } else {
    await db.execute('CREATE TEMP TABLE IF NOT EXISTS _scored_ids (id TEXT PRIMARY KEY)');
    await db.execute('DELETE FROM _scored_ids');
    for (let i = 0; i < scoredAreaIds.length; i += DELETE_CHUNK) {
      const chunk = scoredAreaIds.slice(i, i + DELETE_CHUNK);
      const stmts = chunk.map(id => ({
        sql: `INSERT OR IGNORE INTO _scored_ids (id) VALUES (?)`,
        args: [id],
      }));
      await db.batch(stmts, 'write');
    }
    const res = await db.execute(
      `DELETE FROM safety_scores WHERE geo_area_id NOT IN (SELECT id FROM _scored_ids)`
    );
    deletedStale = Number(res.rowsAffected ?? 0);
    await db.execute('DROP TABLE _scored_ids');
  }
  log.info({ deletedStale }, 'deleted stale safety_scores rows');

  // --- Step 5b: Report tract coverage ---
  const tractAreas = await db.execute(
    `SELECT id FROM geo_areas WHERE area_type = 'tract'`
  );
  let tractsScored = 0;
  let tractsUnscored = 0;
  for (const row of tractAreas.rows) {
    const id = row.id as string;
    if (!scores.has(id) || scores.get(id)!.score === null) {
      tractsUnscored++;
    } else {
      tractsScored++;
    }
  }
  log.info({ tractsScored, tractsUnscored }, 'tract coverage');

  // --- Step 6: Legacy crime_stats backfill ---
  log.info('backfilling legacy crime_stats');
  await backfillLegacyCrimeStats(areaCountsMap, scores);

  // --- Summary ---
  log.info(
    {
      observations: allObsDb.length,
      uniqueGeoAreas: uniqueAreas.size,
      safetyScores: scores.size,
    },
    'ingestion summary'
  );
}

async function backfillLegacyCrimeStats(
  areaCountsMap: Map<string, AreaCrimeCounts>,
  scores: Map<string, { score: number | null; percentile: number | null }>
): Promise<void> {
  // Map station_id → city:slug, then look up counts + score
  const now = new Date();
  const dataYear = now.getFullYear();
  const dataMonth = now.getMonth() + 1;

  function slugify(city: string): string {
    return city.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
  }

  const stmts: Array<{ sql: string; args: any[] }> = [];

  for (const [stationId, cityName] of Object.entries(STATION_CITY)) {
    const geoAreaId = `city:${slugify(cityName)}`;
    const counts = areaCountsMap.get(geoAreaId);
    const score = scores.get(geoAreaId);

    if (!counts) continue;

    const total = counts.violent + counts.property + counts.vehicle + counts.qualityOfLife;
    // safety_score is on the unified 0-1 scale (0 = safest, 1 = most dangerous).
    // Fallback 0.5 = neutral midpoint, used only when the city has crime counts
    // but no computed ensemble score (e.g. no_population).
    const scoreVal = score?.score ?? 0.5;

    stmts.push({
      sql: `INSERT INTO crime_stats
            (station_id, data_year, data_month, violent_crime_count, property_crime_count, vehicle_crime_count, total_incidents, safety_score, source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ca_doj', datetime('now'))
            ON CONFLICT(station_id, data_year, data_month) DO UPDATE SET
              violent_crime_count = excluded.violent_crime_count,
              property_crime_count = excluded.property_crime_count,
              vehicle_crime_count = excluded.vehicle_crime_count,
              total_incidents = excluded.total_incidents,
              safety_score = excluded.safety_score,
              fetched_at = excluded.fetched_at`,
      args: [stationId, dataYear, dataMonth, counts.violent, counts.property, counts.vehicle, total, scoreVal],
    });
  }

  if (stmts.length > 0) {
    await db.batch(stmts, 'write');
    log.info({ count: stmts.length }, 'backfilled legacy crime_stats');
  } else {
    log.info('no city-level data to backfill into crime_stats');
  }
}
