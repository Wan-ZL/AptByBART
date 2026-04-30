/**
 * Backfill apartments.geo_area_id via spatial lookup, in priority order:
 *   1. SF neighborhood (finest granularity)
 *   2. Oakland beat
 *   3. Census tract (covers East/South/Peninsula BART cities)
 *   4. Fallback: city via nearest_station_id (coarse last-resort)
 *
 * Each apartment gets the single most-granular geo_area_id we can resolve;
 * safety_scores is then joined off that one column in the apartment APIs,
 * replacing the legacy crime_stats.station_id misattribution path (where
 * the whole-city CA-DOJ total was broadcast to every station in the city).
 *
 * Idempotent — re-running updates rows rather than duplicating. Runs from
 * most-granular to least so earlier, better matches are preserved.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';

// Load .env.local manually (no dotenv dependency).
try {
  const envPath = resolve(__dirname, '..', '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // No .env.local — local.db fallback is fine.
}

// Station → city fallback for apartments whose lat/lng lands in none of the
// three shape files (rare edge: point just outside all polygons). Mirrors the
// STATION_CITY table in seed-geo-areas.ts.
const STATION_CITY: Record<string, string> = {
  EMBR: 'San Francisco', MONT: 'San Francisco', POWL: 'San Francisco',
  CIVC: 'San Francisco', '16TH': 'San Francisco', '24TH': 'San Francisco',
  GLEN: 'San Francisco', BALB: 'San Francisco',
  DALY: 'Daly City', COLM: 'Daly City',
  SSAN: 'South San Francisco', SBRN: 'San Bruno', MLBR: 'Millbrae',
  SFIA: 'San Bruno',
  WOAK: 'Oakland', '12TH': 'Oakland', '19TH': 'Oakland',
  LAKE: 'Oakland', FTVL: 'Oakland', COLS: 'Oakland',
  MCAR: 'Oakland', OAKL: 'Oakland',
  ROCK: 'Oakland', ASHB: 'Berkeley', DBRK: 'Berkeley', NBRK: 'Berkeley',
  PLZA: 'El Cerrito', DELN: 'Richmond', RICH: 'Richmond',
  ORIN: 'Orinda', LAFY: 'Lafayette', WCRK: 'Walnut Creek',
  PHIL: 'Pleasant Hill', CONC: 'Concord', NCON: 'Concord',
  PITT: 'Pittsburg', PCTR: 'Pittsburg', ANTC: 'Antioch',
  BAYF: 'San Leandro', SANL: 'San Leandro',
  HAYW: 'Hayward', SHAY: 'Hayward',
  UCTY: 'Union City', FRMT: 'Fremont', WARM: 'Fremont',
  CAST: 'Hayward',
  DUBL: 'Dublin', WDUB: 'Dublin',
  MLPT: 'Milpitas', BERY: 'San Jose',
};

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

interface Feature {
  type: 'Feature';
  geometry: any;
  properties: Record<string, any>;
}

interface GeoJson {
  type: 'FeatureCollection';
  features: Feature[];
}

function loadGeoJson(relPath: string): Feature[] {
  const p = resolve(__dirname, '..', 'public', relPath);
  const j: GeoJson = JSON.parse(readFileSync(p, 'utf-8'));
  return j.features ?? [];
}

function pipFirstMatch(
  lng: number,
  lat: number,
  features: Feature[],
): Feature | null {
  const pt = turfPoint([lng, lat]);
  for (const f of features) {
    try {
      if (booleanPointInPolygon(pt, f.geometry)) return f;
    } catch {
      // Invalid geometry — skip.
    }
  }
  return null;
}

async function main() {
  console.log('=== Backfill apartments.geo_area_id ===\n');

  console.log('Loading shape files...');
  const sfNeighborhoods = loadGeoJson('sf-neighborhoods.geojson');
  const oaklandBeats = loadGeoJson('oakland-beats.geojson');
  const tracts = loadGeoJson('census-tracts.geojson');
  console.log(
    `  sf-neighborhoods: ${sfNeighborhoods.length}, oakland-beats: ${oaklandBeats.length}, tracts: ${tracts.length}`,
  );

  // Verify each resolved geo_area_id is actually present in geo_areas so
  // the FK is valid (census tracts not in the DB would silently break joins).
  const geoRows = await db.execute('SELECT id FROM geo_areas');
  const geoIds = new Set<string>(geoRows.rows.map(r => r.id as string));
  console.log(`  geo_areas in DB: ${geoIds.size}\n`);

  const aptsResult = await db.execute(
    'SELECT id, lat, lng, nearest_station_id FROM apartments',
  );
  console.log(`Apartments to process: ${aptsResult.rows.length}\n`);

  const counts = {
    neighborhood: 0,
    beat: 0,
    tract: 0,
    city: 0,
    unresolved: 0,
    missingInDb: 0,
  };

  for (const row of aptsResult.rows) {
    const aptId = row.id as number;
    const lat = row.lat as number;
    const lng = row.lng as number;
    const stationId = row.nearest_station_id as string | null;

    let resolvedId: string | null = null;
    let bucket: keyof typeof counts | null = null;

    // 1. SF neighborhood
    const nMatch = pipFirstMatch(lng, lat, sfNeighborhoods);
    if (nMatch) {
      resolvedId = `neighborhood:${nMatch.properties.SLUG}`;
      bucket = 'neighborhood';
    }

    // 2. Oakland beat
    if (!resolvedId) {
      const bMatch = pipFirstMatch(lng, lat, oaklandBeats);
      if (bMatch) {
        resolvedId = `beat:${bMatch.properties.SLUG}`;
        bucket = 'beat';
      }
    }

    // 3. Census tract
    if (!resolvedId) {
      const tMatch = pipFirstMatch(lng, lat, tracts);
      if (tMatch) {
        resolvedId = `tract:${tMatch.properties.GEOID}`;
        bucket = 'tract';
      }
    }

    // 4. City fallback via nearest station
    if (!resolvedId && stationId && STATION_CITY[stationId]) {
      resolvedId = `city:${toSlug(STATION_CITY[stationId])}`;
      bucket = 'city';
    }

    if (!resolvedId) {
      counts.unresolved++;
      continue;
    }

    // Guard against FK violations when a shape-file match refers to a
    // geo_area that hasn't been seeded yet. Fall back to null rather than
    // crashing the backfill.
    if (!geoIds.has(resolvedId)) {
      counts.missingInDb++;
      resolvedId = null;
    }

    await db.execute({
      sql: 'UPDATE apartments SET geo_area_id = ? WHERE id = ?',
      args: [resolvedId, aptId],
    });

    if (resolvedId && bucket) counts[bucket]++;
  }

  console.log('--- Results ---');
  console.log(`  neighborhood: ${counts.neighborhood}`);
  console.log(`  beat:         ${counts.beat}`);
  console.log(`  tract:        ${counts.tract}`);
  console.log(`  city:         ${counts.city}`);
  console.log(`  unresolved:   ${counts.unresolved}`);
  console.log(`  missing-in-db:${counts.missingInDb}`);

  const verify = await db.execute(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN geo_area_id IS NOT NULL THEN 1 ELSE 0 END) AS with_area
     FROM apartments`,
  );
  const vRow = verify.rows[0];
  console.log(`\nDB check: ${vRow.with_area}/${vRow.total} apartments have geo_area_id`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
