/**
 * Crime ingestion orchestrator
 * Runs all ingesters, writes observations to DB, computes safety scores.
 */

import { db } from '../../db/client';
import type { CrimeIngester, CrimeObservation, CrimeCategory } from '../../lib/crime-taxonomy';
import { DEFAULT_WEIGHTS } from '../../lib/crime-taxonomy';
import { computeSafetyScores, type AreaCrimeCounts } from '../../lib/safety-scoring';
import { STATION_CITY } from './ca-doj';

export async function runIngestion(ingesters: CrimeIngester[]): Promise<void> {
  const allObservations: CrimeObservation[] = [];

  // --- Step 1: Register data sources ---
  console.log('--- Registering data sources ---');
  for (const ing of ingesters) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO crime_data_sources (id, name, api_type, granularity, update_frequency, status)
            VALUES (?, ?, ?, ?, ?, 'active')`,
      args: [ing.sourceId, ing.sourceName, ing.apiType, ing.granularity, ing.updateFrequency],
    });
  }

  // --- Step 2: Run each ingester ---
  for (const ing of ingesters) {
    console.log(`\n--- Running ${ing.sourceName} (${ing.sourceId}) ---`);
    const startMs = Date.now();

    try {
      const observations = await ing.fetch();
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`  Completed in ${elapsed}s — ${observations.length} observations`);

      allObservations.push(...observations);

      // Update source metadata
      await db.execute({
        sql: `UPDATE crime_data_sources
              SET last_fetched_at = datetime('now'), last_success_at = datetime('now'), record_count = ?
              WHERE id = ?`,
        args: [observations.length, ing.sourceId],
      });
    } catch (err) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      console.error(`  FAILED after ${elapsed}s: ${(err as Error).message}`);

      await db.execute({
        sql: `UPDATE crime_data_sources SET last_fetched_at = datetime('now') WHERE id = ?`,
        args: [ing.sourceId],
      });
    }
  }

  if (allObservations.length === 0) {
    console.log('\nNo observations collected. Skipping DB write.');
    return;
  }

  // --- Step 3: Ensure geo_areas exist ---
  console.log(`\n--- Ensuring geo_areas for ${allObservations.length} observations ---`);
  const uniqueAreas = new Set(allObservations.map(o => o.geoAreaId));
  const geoAreaStmts = [...uniqueAreas].map(areaId => {
    const [areaType, ...rest] = areaId.split(':');
    const slug = rest.join(':');
    const name = slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      sql: `INSERT OR IGNORE INTO geo_areas (id, name, area_type) VALUES (?, ?, ?)`,
      args: [areaId, name, areaType],
    };
  });
  if (geoAreaStmts.length > 0) {
    await db.batch(geoAreaStmts, 'write');
    console.log(`  Ensured ${geoAreaStmts.length} geo_areas`);
  }

  // --- Step 4: Bulk insert observations ---
  console.log('\n--- Writing crime_observations ---');
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
  console.log(`  Wrote ${written} observations`);

  // --- Step 5: Aggregate and compute safety scores ---
  console.log('\n--- Computing safety scores ---');
  const areaCountsMap = new Map<string, AreaCrimeCounts>();

  // Fetch population data for all geo_areas
  const popResult = await db.execute('SELECT id, population FROM geo_areas WHERE population IS NOT NULL');
  const populationMap = new Map<string, number>();
  for (const row of popResult.rows) {
    populationMap.set(row.id as string, row.population as number);
  }
  console.log(`  Loaded population data for ${populationMap.size} geo_areas`);

  // Build per-source area counts for per-source percentile normalization
  const perSourceData = new Map<string, Map<string, AreaCrimeCounts>>();

  for (const obs of allObservations) {
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

  console.log(`  Built per-source data for ${perSourceData.size} sources`);
  const scores = computeSafetyScores(areaCountsMap, DEFAULT_WEIGHTS, perSourceData);

  // Upsert into safety_scores
  const scoreStmts = [...scores.entries()].map(([areaId, { score, percentile }]) => {
    const counts = areaCountsMap.get(areaId)!;
    const total = counts.violent + counts.property + counts.vehicle + counts.qualityOfLife;
    // Collect which sources contributed to this area
    const sources = [...new Set(
      allObservations.filter(o => o.geoAreaId === areaId).map(o => o.sourceId)
    )].join(',');

    return {
      sql: `INSERT INTO safety_scores (geo_area_id, score, violent_count, property_count, vehicle_count, quality_of_life_count, total_incidents, sources_used, percentile_rank, computed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(geo_area_id) DO UPDATE SET
              score = excluded.score,
              violent_count = excluded.violent_count,
              property_count = excluded.property_count,
              vehicle_count = excluded.vehicle_count,
              quality_of_life_count = excluded.quality_of_life_count,
              total_incidents = excluded.total_incidents,
              sources_used = excluded.sources_used,
              percentile_rank = excluded.percentile_rank,
              computed_at = excluded.computed_at`,
      args: [areaId, score, counts.violent, counts.property, counts.vehicle, counts.qualityOfLife, total, sources, percentile],
    };
  });

  for (let i = 0; i < scoreStmts.length; i += CHUNK_SIZE) {
    await db.batch(scoreStmts.slice(i, i + CHUNK_SIZE), 'write');
  }
  console.log(`  Computed ${scores.size} safety scores`);

  // --- Step 5b: Inherit city scores to census tracts ---
  console.log('\n--- Inheriting city scores to census tracts ---');
  const tractAreas = await db.execute(
    `SELECT id, parent_area_id FROM geo_areas WHERE area_type = 'tract'`
  );
  let tractCount = 0;
  for (const tract of tractAreas.rows) {
    const tractId = tract.id as string;
    const parentId = tract.parent_area_id as string;
    if (!parentId) continue;

    const parentScore = scores.get(parentId);
    const parentCounts = areaCountsMap.get(parentId);
    if (parentScore && parentCounts) {
      scores.set(tractId, { ...parentScore });
      areaCountsMap.set(tractId, { ...parentCounts });
      tractCount++;
    }
  }
  console.log(`  Inherited scores to ${tractCount} census tracts`);

  // Write tract scores to DB
  if (tractCount > 0) {
    const tractStmts = [...tractAreas.rows]
      .filter(tract => {
        const tractId = tract.id as string;
        return scores.has(tractId);
      })
      .map(tract => {
        const tractId = tract.id as string;
        const parentId = tract.parent_area_id as string;
        const { score, percentile } = scores.get(tractId)!;
        const counts = areaCountsMap.get(tractId)!;
        const total = counts.violent + counts.property + counts.vehicle + counts.qualityOfLife;
        const parentSources = [...new Set(
          allObservations.filter(o => o.geoAreaId === parentId).map(o => o.sourceId)
        )].join(',');

        return {
          sql: `INSERT INTO safety_scores (geo_area_id, score, violent_count, property_count, vehicle_count, quality_of_life_count, total_incidents, sources_used, percentile_rank, computed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(geo_area_id) DO UPDATE SET
                  score = excluded.score,
                  violent_count = excluded.violent_count,
                  property_count = excluded.property_count,
                  vehicle_count = excluded.vehicle_count,
                  quality_of_life_count = excluded.quality_of_life_count,
                  total_incidents = excluded.total_incidents,
                  sources_used = excluded.sources_used,
                  percentile_rank = excluded.percentile_rank,
                  computed_at = excluded.computed_at`,
          args: [tractId, score, counts.violent, counts.property, counts.vehicle, counts.qualityOfLife, total, parentSources, percentile],
        };
      });

    for (let i = 0; i < tractStmts.length; i += CHUNK_SIZE) {
      await db.batch(tractStmts.slice(i, i + CHUNK_SIZE), 'write');
    }
    console.log(`  Wrote ${tractStmts.length} tract safety scores to DB`);
  }

  // --- Step 6: Legacy crime_stats backfill ---
  console.log('\n--- Backfilling legacy crime_stats ---');
  await backfillLegacyCrimeStats(areaCountsMap, scores);

  // --- Summary ---
  console.log('\n=== Ingestion Summary ===');
  console.log(`  Total observations: ${allObservations.length}`);
  console.log(`  Unique geo areas:   ${uniqueAreas.size}`);
  console.log(`  Safety scores:      ${scores.size}`);
}

async function backfillLegacyCrimeStats(
  areaCountsMap: Map<string, AreaCrimeCounts>,
  scores: Map<string, { score: number; percentile: number }>
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
    const scoreVal = score?.score ?? 5.0;

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
    console.log(`  Backfilled ${stmts.length} legacy crime_stats records`);
  } else {
    console.log('  No city-level data to backfill into crime_stats');
  }
}
