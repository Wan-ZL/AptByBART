/**
 * Authoritative fix for tract parent_area_id misassignments using
 * the Census 2022 TIGER Place shapefile as ground truth.
 *
 * Replaces the OSM-derived bay-area-cities.geojson approach. Census Places
 * include both incorporated cities (CLASSFP=C1) and Census Designated Places
 * (CLASSFP=U1/U2 — dense unincorporated communities). This means tracts inside
 * CDPs (e.g. Castro Valley, Marin City, Sea Ranch) now get a valid city-level
 * parent instead of falling back to county:*.
 *
 * Steps:
 *  1. Load public/bay-area-places-census.geojson (produced by fetch-census-places.ts).
 *  2. Seed each place into geo_areas as area_type='city' with parent=county:<slug>.
 *     CDPs are stored as area_type='city' too — they're place-level units and
 *     the downstream renderer/ingest doesn't care about incorporation status.
 *  3. For every tract whose parent_area_id starts with county:*, run PIP of its
 *     centroid against places in the same county. If inside → reparent to
 *     city:<slug_of_place_name>. Else leave as county:* (genuinely outside any
 *     Census Place / unincorporated).
 *
 * Idempotent: upserts on city rows and only touches tracts that currently
 * point at county:*.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';
import { db } from '../db/client';

const PROJECT_ROOT = resolve(__dirname, '..');

// Load .env.local manually (no dotenv dependency)
try {
  const envPath = resolve(PROJECT_ROOT, '.env.local');
  const envText = readFileSync(envPath, 'utf-8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not found — fine for local dev
}

// Map tract GEOID digits 2..5 → county slug (used only for snapshot output).
const FIPS_TO_COUNTY: Record<string, string> = {
  '001': 'alameda',
  '013': 'contra_costa',
  '041': 'marin',
  '055': 'napa',
  '075': 'san_francisco',
  '081': 'san_mateo',
  '085': 'santa_clara',
  '095': 'solano',
  '097': 'sonoma',
};

interface PlaceProps {
  placeId: string;       // e.g. place:0656000
  GEOID: string;         // 7-digit
  PLACEFP: string;
  CLASSFP: string;
  NAME: string;
  NAMELSAD: string;
  slug: string;
  county: string;        // county slug
  countyName: string;
  centroidLat: number;
  centroidLng: number;
}

type PlaceFeature = Feature<Polygon | MultiPolygon, PlaceProps>;

interface PlaceRecord {
  id: string;            // city:<slug> (derived from slug, with dedupe suffix)
  name: string;
  countySlug: string;
  classfp: string;
  geoid: string;
  centroidLat: number;
  centroidLng: number;
  feature: PlaceFeature;
}

function loadPlaces(): PlaceRecord[] {
  const path = join(PROJECT_ROOT, 'public', 'bay-area-places-census.geojson');
  const fc = JSON.parse(readFileSync(path, 'utf-8')) as FeatureCollection<Polygon | MultiPolygon, PlaceProps>;
  const out: PlaceRecord[] = [];
  const seenIds = new Set<string>();

  for (const feature of fc.features) {
    const props = feature.properties;
    let baseId = `city:${props.slug}`;
    let id = baseId;
    // Dedupe: two places can share a slug across counties (e.g. "Rancho" CDPs).
    // If conflict → suffix with county slug.
    if (seenIds.has(id)) {
      id = `city:${props.slug}_${props.county}`;
      if (seenIds.has(id)) {
        // Final fallback: suffix with GEOID (unique).
        id = `city:${props.slug}_${props.GEOID}`;
      }
    }
    seenIds.add(id);

    out.push({
      id,
      name: props.NAME,
      countySlug: props.county,
      classfp: props.CLASSFP,
      geoid: props.GEOID,
      centroidLat: props.centroidLat,
      centroidLng: props.centroidLng,
      feature: feature as PlaceFeature,
    });
  }
  return out;
}

async function seedPlaces(places: PlaceRecord[]): Promise<{ inserted: number; updated: number }> {
  const existing = await db.execute("SELECT id FROM geo_areas WHERE area_type = 'city'");
  const existingIds = new Set(existing.rows.map(r => r.id as string));

  let inserted = 0;
  let updated = 0;

  for (const place of places) {
    const isNew = !existingIds.has(place.id);
    await db.execute({
      sql: `INSERT INTO geo_areas
              (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population)
            VALUES (?, ?, 'city', ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              parent_area_id = excluded.parent_area_id,
              centroid_lat = excluded.centroid_lat,
              centroid_lng = excluded.centroid_lng`,
      args: [
        place.id,
        place.name,
        `county:${place.countySlug}`,
        place.centroidLat,
        place.centroidLng,
      ],
    });
    if (isNew) inserted++; else updated++;
  }
  return { inserted, updated };
}

interface TractRow {
  id: string;
  geoid: string;
  countyFips: string;
  lat: number;
  lng: number;
}

async function loadCountyParentedTracts(): Promise<TractRow[]> {
  const res = await db.execute(`
    SELECT id, centroid_lat, centroid_lng
    FROM geo_areas
    WHERE area_type = 'tract' AND parent_area_id LIKE 'county:%'
  `);
  const out: TractRow[] = [];
  for (const row of res.rows) {
    const id = row.id as string;
    const geoid = id.replace(/^tract:/, '');
    const countyFips = geoid.slice(2, 5);
    const lat = row.centroid_lat as number | null;
    const lng = row.centroid_lng as number | null;
    if (lat == null || lng == null) continue;
    out.push({ id, geoid, countyFips, lat, lng });
  }
  return out;
}

async function reparentTracts(
  tracts: TractRow[],
  places: PlaceRecord[],
): Promise<{ reparented: number; leftUnincorporated: number; byCounty: Record<string, { reparented: number; unincorporated: number }> }> {
  const placesByCounty = new Map<string, PlaceRecord[]>();
  for (const p of places) {
    const arr = placesByCounty.get(p.countySlug) ?? [];
    arr.push(p);
    placesByCounty.set(p.countySlug, arr);
  }

  let reparented = 0;
  let leftUnincorporated = 0;
  const byCounty: Record<string, { reparented: number; unincorporated: number }> = {};

  for (const tract of tracts) {
    const countySlug = FIPS_TO_COUNTY[tract.countyFips];
    if (!countySlug) { leftUnincorporated++; continue; }
    byCounty[countySlug] ??= { reparented: 0, unincorporated: 0 };

    const candidates = placesByCounty.get(countySlug) ?? [];
    const pt = point([tract.lng, tract.lat]);

    let match: PlaceRecord | null = null;
    for (const place of candidates) {
      try {
        if (booleanPointInPolygon(pt, place.feature)) {
          match = place;
          break;
        }
      } catch {
        // Skip invalid geometry
      }
    }

    if (match) {
      await db.execute({
        sql: 'UPDATE geo_areas SET parent_area_id = ? WHERE id = ?',
        args: [match.id, tract.id],
      });
      reparented++;
      byCounty[countySlug].reparented++;
    } else {
      leftUnincorporated++;
      byCounty[countySlug].unincorporated++;
    }
  }

  return { reparented, leftUnincorporated, byCounty };
}

async function snapshot(label: string) {
  const res = await db.execute(`
    SELECT substr(id, 9, 3) AS county_fips,
      SUM(CASE WHEN parent_area_id LIKE 'county:%' THEN 1 ELSE 0 END) AS county_parented,
      SUM(CASE WHEN parent_area_id LIKE 'city:%' THEN 1 ELSE 0 END) AS city_parented
    FROM geo_areas
    WHERE area_type = 'tract'
    GROUP BY county_fips
    ORDER BY county_fips
  `);
  console.log(`\n--- ${label} ---`);
  console.log('county_fips | county_parented | city_parented');
  console.log('------------|-----------------|--------------');
  let totalCounty = 0;
  let totalCity = 0;
  for (const row of res.rows) {
    const cp = Number(row.county_parented);
    const cty = Number(row.city_parented);
    totalCounty += cp;
    totalCity += cty;
    console.log(
      `${String(row.county_fips).padEnd(11)} | ${String(cp).padStart(15)} | ${String(cty).padStart(13)}`,
    );
  }
  console.log('------------|-----------------|--------------');
  console.log(
    `total       | ${String(totalCounty).padStart(15)} | ${String(totalCity).padStart(13)}`,
  );
}

async function main() {
  console.log('=== Fix tract parent_area_id using Census TIGER Places ===');

  await snapshot('BEFORE');

  console.log('\nStep 1: loading Census places from public/bay-area-places-census.geojson...');
  const places = loadPlaces();
  console.log(`  loaded ${places.length} places`);

  console.log('\nStep 2: seeding places into geo_areas (upsert)...');
  const { inserted, updated } = await seedPlaces(places);
  console.log(`  inserted ${inserted} new city rows`);
  console.log(`  updated ${updated} existing city rows`);

  console.log('\nStep 3: loading county-parented tracts...');
  const tracts = await loadCountyParentedTracts();
  console.log(`  ${tracts.length} tracts currently parented to county:*`);

  console.log('\nStep 4: spatial reparent (tract centroid PIP against Census Places)...');
  const { reparented, leftUnincorporated, byCounty } = await reparentTracts(tracts, places);
  console.log(`  reparented ${reparented} tracts to city:*`);
  console.log(`  left ${leftUnincorporated} as county:* (true unincorporated)`);
  console.log('\n  per-county breakdown of reparent pass:');
  for (const [county, stats] of Object.entries(byCounty).sort()) {
    console.log(`    ${county.padEnd(15)} reparented=${String(stats.reparented).padStart(3)}  unincorporated=${String(stats.unincorporated).padStart(3)}`);
  }

  await snapshot('AFTER');

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
