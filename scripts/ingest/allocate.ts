/**
 * Equal-weight ensemble allocator — every source allocates to every tract it covers.
 *
 * For EVERY source, emit one `crime_observations` row per (tract, source, category, period)
 * with the source's original `source_id`. No "allocated_*" synthetic sources; no
 * "direct trumps allocated" filter. Downstream scoring averages per-source percentile
 * ranks, so each source contributes equally regardless of native granularity.
 *
 * Allocation by source area type:
 *   - tract           → passthrough (1:1)
 *   - neighborhood    → spatial overlap × tract pop, against public/sf-neighborhoods.geojson
 *   - beat            → spatial overlap × tract pop, against public/oakland-beats.geojson
 *   - city            → tract_pop / city_pop × city_count
 *   - county          → tract_pop / county_pop × county_count
 *   - state           → tract_pop / state_pop × state_count
 *
 * Idempotent: clears every tract:-keyed row before re-emitting.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Client } from '@libsql/client';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon, featureCollection } from '@turf/helpers';
import { difference as turfDifference } from '@turf/difference';
import turfArea from '@turf/area';
import bbox from '@turf/bbox';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';

interface GeoArea {
  id: string;
  areaType: string;
  parentAreaId: string | null;
  population: number | null;
  centroidLat: number | null;
  centroidLng: number | null;
}

interface Observation {
  sourceId: string;
  geoAreaId: string;
  category: string;
  periodStart: string;
  periodEnd: string;
  incidentCount: number;
}

interface TractGeom {
  id: string;
  feature: Feature<Polygon | MultiPolygon>;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  area: number; // m^2
  population: number;
}

interface SubCityGeom {
  geoAreaId: string; // e.g. neighborhood:mission, beat:10y
  feature: Feature<Polygon | MultiPolygon>;
  bbox: [number, number, number, number];
  /** overlap by tract id → weight (tract_pop × overlap_fraction). */
  tractWeights: Map<string, number>;
  weightSum: number;
}

function bboxesIntersect(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function toTurfFeature(feature: Feature): Feature<Polygon | MultiPolygon> | null {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    return turfPolygon(geom.coordinates as number[][][], feature.properties ?? {});
  }
  if (geom.type === 'MultiPolygon') {
    return turfMultiPolygon(geom.coordinates as number[][][][], feature.properties ?? {});
  }
  return null;
}

/**
 * Intersection area via difference: area(A) - area(A \ B).
 * Avoids needing @turf/intersect (not installed); turf/difference is.
 */
function intersectionArea(
  a: Feature<Polygon | MultiPolygon>,
  areaA: number,
  b: Feature<Polygon | MultiPolygon>
): number {
  try {
    const diff = turfDifference(featureCollection([a, b])) as
      | Feature<Polygon | MultiPolygon>
      | null;
    if (!diff) return areaA; // A fully inside B
    const areaDiff = turfArea(diff);
    return Math.max(0, areaA - areaDiff);
  } catch {
    // Fallback: centroid point-in-polygon → all or nothing.
    try {
      // use a crude coordinate sample — first point of ring
      const coords = (a.geometry.type === 'Polygon'
        ? (a.geometry.coordinates[0] as number[][])[0]
        : ((a.geometry.coordinates as number[][][][])[0][0] as number[][])[0]);
      if (coords && booleanPointInPolygon(turfPoint(coords as [number, number]), b)) {
        return areaA;
      }
    } catch {}
    return 0;
  }
}

function loadGeoJson(filename: string): FeatureCollection {
  const path = resolve(process.cwd(), 'public', filename);
  return JSON.parse(readFileSync(path, 'utf-8')) as FeatureCollection;
}

/**
 * Build a map of every descendant tract (transitively) under a given area id.
 * Tracts live at area_type='tract'; their parents are cities; cities' parents are
 * counties; county parent is state:california.
 */
function buildTractsByAncestor(areas: Map<string, GeoArea>): Map<string, GeoArea[]> {
  const directChildrenOf = new Map<string, GeoArea[]>();
  for (const a of areas.values()) {
    if (!a.parentAreaId) continue;
    if (!directChildrenOf.has(a.parentAreaId)) directChildrenOf.set(a.parentAreaId, []);
    directChildrenOf.get(a.parentAreaId)!.push(a);
  }
  const cache = new Map<string, GeoArea[]>();
  function descendantsOf(id: string): GeoArea[] {
    if (cache.has(id)) return cache.get(id)!;
    const out: GeoArea[] = [];
    const stack: GeoArea[] = [...(directChildrenOf.get(id) ?? [])];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.areaType === 'tract') {
        out.push(node);
        continue;
      }
      for (const c of directChildrenOf.get(node.id) ?? []) stack.push(c);
    }
    cache.set(id, out);
    return out;
  }
  const result = new Map<string, GeoArea[]>();
  for (const a of areas.values()) {
    result.set(a.id, descendantsOf(a.id));
  }
  return result;
}

export async function runAllocator(db: Client): Promise<{
  deletedTractRows: number;
  writtenTractRows: number;
  bySource: Record<string, number>;
}> {
  console.log('\n--- Running equal-weight ensemble allocator ---');

  // --- 1. Load all geo_areas ---
  const areasRes = await db.execute(
    `SELECT id, area_type, parent_area_id, population, centroid_lat, centroid_lng FROM geo_areas`
  );
  const areas = new Map<string, GeoArea>();
  for (const r of areasRes.rows) {
    areas.set(r.id as string, {
      id: r.id as string,
      areaType: r.area_type as string,
      parentAreaId: (r.parent_area_id as string | null) ?? null,
      population: (r.population as number | null) ?? null,
      centroidLat: (r.centroid_lat as number | null) ?? null,
      centroidLng: (r.centroid_lng as number | null) ?? null,
    });
  }
  const tracts: GeoArea[] = [];
  for (const a of areas.values()) if (a.areaType === 'tract') tracts.push(a);
  console.log(`  Loaded ${areas.size} geo_areas (${tracts.length} tracts)`);

  // --- 2. Load source metadata to distinguish tract-native sources from ---
  //        aggregators whose tract rows (if any) are stale allocator output.
  const srcRes = await db.execute(
    `SELECT id, granularity FROM crime_data_sources`
  );
  const sourceGranularity = new Map<string, string>();
  for (const r of srcRes.rows) {
    sourceGranularity.set(r.id as string, r.granularity as string);
  }

  // --- 3. Load ALL existing crime_observations, then delete tract rows. ---
  //        Tract rows from sources whose declared granularity != 'tract' are
  //        stale allocator output from prior runs — we drop them. Tract rows
  //        from tract-native sources (e.g. alameda_sheriff) are passed through.
  const obsRes = await db.execute(
    `SELECT source_id, geo_area_id, category, period_start, period_end, incident_count
     FROM crime_observations`
  );
  const allObs: Observation[] = obsRes.rows.map(r => ({
    sourceId: r.source_id as string,
    geoAreaId: r.geo_area_id as string,
    category: r.category as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    incidentCount: Number(r.incident_count ?? 0),
  }));

  const delTracts = await db.execute(
    `DELETE FROM crime_observations WHERE geo_area_id LIKE 'tract:%'`
  );
  const deletedTractRows = Number(delTracts.rowsAffected ?? 0);
  console.log(`  Cleared ${deletedTractRows} prior tract-level rows`);

  // Also clear legacy synthetic 'allocated_*' rows — they no longer fit the model.
  const delLegacy = await db.execute(
    `DELETE FROM crime_observations WHERE source_id LIKE 'allocated_%'`
  );
  const deletedLegacy = Number(delLegacy.rowsAffected ?? 0);
  if (deletedLegacy > 0) console.log(`  Cleared ${deletedLegacy} legacy allocated_* rows`);

  // Non-tract obs from real sources → feed the allocator.
  const sourceObs = allObs.filter(
    o => !o.geoAreaId.startsWith('tract:') && !o.sourceId.startsWith('allocated_')
  );
  // Tract-direct obs: keep only rows whose source is declared as tract-native.
  // Anything else is leftover from a prior allocator run and must NOT re-seed as rank-0.
  const tractDirectObs = allObs.filter(o => {
    if (!o.geoAreaId.startsWith('tract:')) return false;
    if (o.sourceId.startsWith('allocated_')) return false;
    return sourceGranularity.get(o.sourceId) === 'tract';
  });
  const droppedStaleTracts = allObs.filter(
    o =>
      o.geoAreaId.startsWith('tract:') &&
      !o.sourceId.startsWith('allocated_') &&
      sourceGranularity.get(o.sourceId) !== 'tract'
  ).length;
  if (droppedStaleTracts > 0) {
    console.log(`  Dropped ${droppedStaleTracts} stale tract rows from non-tract-native sources`);
  }

  // --- 3. Precompute tract geometry + bbox (needed only for spatial sources) ---
  //        Load tract GeoJSON and index by id.
  const tractsFc = loadGeoJson('census-tracts.geojson');
  const tractGeomById = new Map<string, TractGeom>();
  for (const f of tractsFc.features) {
    const geoid = (f.properties?.GEOID ?? f.properties?.geoid) as string | undefined;
    if (!geoid) continue;
    const id = `tract:${geoid}`;
    const area = areas.get(id);
    if (!area) continue;
    const turf = toTurfFeature(f as Feature);
    if (!turf) continue;
    let a = 0;
    try { a = turfArea(turf); } catch { continue; }
    if (a <= 0) continue;
    tractGeomById.set(id, {
      id,
      feature: turf,
      bbox: bbox(turf) as [number, number, number, number],
      area: a,
      population: area.population ?? 0,
    });
  }
  console.log(`  Indexed ${tractGeomById.size} tract polygons`);

  // --- 4. Build per-ancestor tract descendant map for hierarchical sources. ---
  const tractsByAncestor = buildTractsByAncestor(areas);

  // --- 5. Preload sub-city geojson (neighborhoods, beats) and precompute ---
  //        overlaps so every source-period-category observation reuses the same weights.
  function buildSubCityGeoms(
    fc: FeatureCollection,
    keyPrefix: 'neighborhood' | 'beat'
  ): Map<string, SubCityGeom> {
    const out = new Map<string, SubCityGeom>();
    for (const f of fc.features) {
      const slug = (f.properties?.SLUG ?? f.properties?.slug) as string | undefined;
      if (!slug) continue;
      const geoAreaId = `${keyPrefix}:${slug}`;
      if (!areas.has(geoAreaId)) continue;
      const turf = toTurfFeature(f as Feature);
      if (!turf) continue;
      const bb = bbox(turf) as [number, number, number, number];

      const tractWeights = new Map<string, number>();
      let weightSum = 0;
      for (const tg of tractGeomById.values()) {
        if (!bboxesIntersect(bb, tg.bbox)) continue;
        const inter = intersectionArea(tg.feature, tg.area, turf);
        if (inter <= 0) continue;
        const overlapFrac = inter / tg.area;
        // skip sliver overlaps (<1% of tract) to keep the weights sparse
        if (overlapFrac < 0.01) continue;
        const w = tg.population * overlapFrac;
        if (w <= 0) continue;
        tractWeights.set(tg.id, w);
        weightSum += w;
      }
      if (weightSum <= 0) continue;
      out.set(geoAreaId, { geoAreaId, feature: turf, bbox: bb, tractWeights, weightSum });
    }
    return out;
  }
  let subCityGeoms = new Map<string, SubCityGeom>();
  const sfNeighborhoodIds = new Set(
    sourceObs
      .filter(o => o.geoAreaId.startsWith('neighborhood:'))
      .map(o => o.geoAreaId)
  );
  const oaklandBeatIds = new Set(
    sourceObs
      .filter(o => o.geoAreaId.startsWith('beat:'))
      .map(o => o.geoAreaId)
  );
  if (sfNeighborhoodIds.size > 0) {
    const fc = loadGeoJson('sf-neighborhoods.geojson');
    const nbrs = buildSubCityGeoms(fc, 'neighborhood');
    for (const [k, v] of nbrs) subCityGeoms.set(k, v);
    console.log(`  Precomputed overlaps for ${nbrs.size} SF neighborhoods`);
  }
  if (oaklandBeatIds.size > 0) {
    const fc = loadGeoJson('oakland-beats.geojson');
    const bts = buildSubCityGeoms(fc, 'beat');
    for (const [k, v] of bts) subCityGeoms.set(k, v);
    console.log(`  Precomputed overlaps for ${bts.size} Oakland beats`);
  }

  // --- 6. Allocate each observation to tracts, picking the most granular level ---
  //        per (source, tract, category, period). A source that emits city+county+state
  //        rollups for the same crimes (e.g. ca_doj) would triple-count if we summed
  //        every level, so we rank candidates by area type and keep only the finest.
  const AREA_TYPE_RANK: Record<string, number> = {
    tract: 0,
    beat: 1,
    neighborhood: 1,
    city: 2,
    county: 3,
    state: 4,
  };
  type Key = string; // source|tract|category|periodStart|periodEnd
  interface Candidate {
    sourceId: string;
    geoAreaId: string; // tract id
    category: string;
    periodStart: string;
    periodEnd: string;
    incidentCount: number;
    rank: number; // lower = more granular
  }
  const candidates = new Map<Key, Candidate>();

  function offer(c: Candidate) {
    if (c.incidentCount <= 0) return;
    const k = `${c.sourceId}|${c.geoAreaId}|${c.category}|${c.periodStart}|${c.periodEnd}`;
    const prev = candidates.get(k);
    if (!prev || c.rank < prev.rank) {
      candidates.set(k, c);
    } else if (prev.rank === c.rank) {
      // Same granularity for same tract — sum (e.g. two beats both overlap the tract).
      prev.incidentCount += c.incidentCount;
    }
  }

  // 6a. Tract-level direct obs: rank 0 — passthrough.
  for (const o of tractDirectObs) {
    offer({
      sourceId: o.sourceId,
      geoAreaId: o.geoAreaId,
      category: o.category,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      incidentCount: o.incidentCount,
      rank: AREA_TYPE_RANK.tract,
    });
  }

  const skips = { noSrcArea: 0, noTracts: 0, noPop: 0, spatialNoOverlap: 0 };
  const writtenByLevel = { tract: 0, city: 0, county: 0, state: 0, beat: 0, neighborhood: 0 };

  // 6b. All other obs → allocate.
  for (const o of sourceObs) {
    const srcArea = areas.get(o.geoAreaId);
    if (!srcArea) { skips.noSrcArea++; continue; }
    const rank = AREA_TYPE_RANK[srcArea.areaType];
    if (rank === undefined) { skips.noSrcArea++; continue; }

    if (srcArea.areaType === 'city' || srcArea.areaType === 'county' || srcArea.areaType === 'state') {
      const descendants = tractsByAncestor.get(srcArea.id) ?? [];
      if (descendants.length === 0) { skips.noTracts++; continue; }
      // Denominator = the source area's own authoritative population (from Census).
      // Critical for state/county: descendant tracts in our DB only cover the Bay
      // Area (~7.6M), not all of California (~39.5M), so summing them would
      // inflate each tract's share 5x and push Bay Area tracts to top percentiles.
      // Fall back to sum-of-descendant-tract-pops when the stored pop is missing
      // (currently ~20 cities with NULL pop; state/counties are all populated).
      let denom = srcArea.population ?? 0;
      if (denom <= 0) {
        for (const t of descendants) denom += t.population ?? 0;
      }
      if (denom <= 0) { skips.noPop++; continue; }
      for (const t of descendants) {
        const pop = t.population ?? 0;
        if (pop <= 0) continue;
        const share = (o.incidentCount * pop) / denom;
        offer({
          sourceId: o.sourceId,
          geoAreaId: t.id,
          category: o.category,
          periodStart: o.periodStart,
          periodEnd: o.periodEnd,
          incidentCount: share,
          rank,
        });
      }
      writtenByLevel[srcArea.areaType as 'city' | 'county' | 'state'] += descendants.length;
      continue;
    }

    if (srcArea.areaType === 'neighborhood' || srcArea.areaType === 'beat') {
      const sg = subCityGeoms.get(o.geoAreaId);
      if (!sg || sg.weightSum <= 0) { skips.spatialNoOverlap++; continue; }
      for (const [tractId, weight] of sg.tractWeights) {
        const share = (o.incidentCount * weight) / sg.weightSum;
        offer({
          sourceId: o.sourceId,
          geoAreaId: tractId,
          category: o.category,
          periodStart: o.periodStart,
          periodEnd: o.periodEnd,
          incidentCount: share,
          rank,
        });
      }
      writtenByLevel[srcArea.areaType as 'neighborhood' | 'beat'] += sg.tractWeights.size;
      continue;
    }

    // Unknown area type — skip silently.
    skips.noSrcArea++;
  }

  // --- 7. Write out. Round to integer counts; drop rows that round to zero. ---
  const bySource: Record<string, number> = {};
  const rows = Array.from(candidates.values())
    .map(r => ({ ...r, incidentCount: Math.round(r.incidentCount) }))
    .filter(r => r.incidentCount > 0);

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const stmts = chunk.map(r => ({
      sql: `INSERT OR REPLACE INTO crime_observations
            (source_id, geo_area_id, period_start, period_end, category, incident_count, fetched_at, confidence)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1.0)`,
      args: [r.sourceId, r.geoAreaId, r.periodStart, r.periodEnd, r.category, r.incidentCount],
    }));
    await db.batch(stmts, 'write');
    for (const r of chunk) bySource[r.sourceId] = (bySource[r.sourceId] ?? 0) + 1;
  }

  console.log(`  Wrote ${rows.length} tract rows across ${Object.keys(bySource).length} sources`);
  console.log(
    `  By source area type: tract=${writtenByLevel.tract} ` +
      `city=${writtenByLevel.city} county=${writtenByLevel.county} state=${writtenByLevel.state} ` +
      `neighborhood=${writtenByLevel.neighborhood} beat=${writtenByLevel.beat}`
  );
  console.log(
    `  Skips: unknown-src-area=${skips.noSrcArea} no-tracts=${skips.noTracts} ` +
      `no-pop=${skips.noPop} no-spatial-overlap=${skips.spatialNoOverlap}`
  );

  return { deletedTractRows, writtenTractRows: rows.length, bySource };
}
