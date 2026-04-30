/**
 * Fetch Census 2022 TIGER/Line Places for California, filter to Bay Area,
 * and write an authoritative GeoJSON to public/bay-area-places-census.geojson.
 *
 * Source: https://www2.census.gov/geo/tiger/TIGER2022/PLACE/tl_2022_06_place.zip
 *
 * Places include incorporated cities/towns AND Census Designated Places (CDPs).
 * Each feature carries GEOID, NAME, PLACEFP, and CLASSFP.
 *
 * The TIGER/Line Place layer lacks a county FIPS field, so each place's
 * county is derived by spatial containment of its centroid against the
 * Census 2022 TIGER County shapefile for California (tl_2022_us_county.zip
 * filtered to STATEFP=06). The county shapefile is also cached in /tmp.
 *
 * Idempotent: only downloads if the zip/geojson is missing.
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
// @ts-ignore — shapefile has no published types
import * as shapefile from 'shapefile';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import centroid from '@turf/centroid';
import { point } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';

const PROJECT_ROOT = resolve(__dirname, '..');
const TMP_DIR = '/tmp/aptbybart-tiger';

// Bay Area bounding box (covers all 9 counties with generous margin)
const BAY_AREA_BBOX = {
  west: -123.6,
  east: -121.2,
  south: 36.9,
  north: 38.9,
};

// Bay Area county FIPS (California = state 06)
const BAY_AREA_COUNTY_FIPS = new Set([
  '001', // Alameda
  '013', // Contra Costa
  '041', // Marin
  '055', // Napa
  '075', // San Francisco
  '081', // San Mateo
  '085', // Santa Clara
  '095', // Solano
  '097', // Sonoma
]);

const FIPS_TO_COUNTY_SLUG: Record<string, string> = {
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

const PLACE_ZIP_URL = 'https://www2.census.gov/geo/tiger/TIGER2022/PLACE/tl_2022_06_place.zip';
const COUNTY_ZIP_URL = 'https://www2.census.gov/geo/tiger/TIGER2022/COUNTY/tl_2022_us_county.zip';

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

async function downloadIfMissing(url: string, localPath: string) {
  if (existsSync(localPath)) {
    console.log(`  [cached] ${localPath}`);
    return;
  }
  console.log(`  [download] ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const file = createWriteStream(localPath);
  // @ts-ignore — Web stream → Node stream
  await pipeline(Readable.fromWeb(res.body), file);
  console.log(`  [saved] ${localPath}`);
}

function unzipSafe(zipPath: string, destDir: string) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  console.log(`  [unzip] ${zipPath} → ${destDir}`);
  // spawnSync with argv array — no shell, no injection surface.
  const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`unzip failed (status=${r.status}) for ${zipPath}`);
}

function bboxIntersects(b: { xmin: number; ymin: number; xmax: number; ymax: number }): boolean {
  return (
    b.xmax >= BAY_AREA_BBOX.west &&
    b.xmin <= BAY_AREA_BBOX.east &&
    b.ymax >= BAY_AREA_BBOX.south &&
    b.ymin <= BAY_AREA_BBOX.north
  );
}

function geometryBbox(geom: Polygon | MultiPolygon): { xmin: number; ymin: number; xmax: number; ymax: number } {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring as [number, number][]) {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    }
  }
  return { xmin, ymin, xmax, ymax };
}

/** Read a shapefile into an array of GeoJSON features. */
async function readShapefile(shpPath: string): Promise<Feature[]> {
  const source = await shapefile.open(shpPath);
  const features: Feature[] = [];
  while (true) {
    const { done, value } = await source.read();
    if (done) break;
    features.push(value as Feature);
  }
  return features;
}

interface CountyPoly {
  fips: string; // 3-digit county FIPS
  slug: string;
  name: string;
  feature: Feature<Polygon | MultiPolygon>;
}

async function loadBayAreaCountyPolys(): Promise<CountyPoly[]> {
  ensureTmpDir();
  const zipPath = join(TMP_DIR, 'tl_2022_us_county.zip');
  const unzipDir = join(TMP_DIR, 'county');
  await downloadIfMissing(COUNTY_ZIP_URL, zipPath);
  if (!existsSync(join(unzipDir, 'tl_2022_us_county.shp'))) {
    unzipSafe(zipPath, unzipDir);
  }
  const features = await readShapefile(join(unzipDir, 'tl_2022_us_county.shp'));
  const out: CountyPoly[] = [];
  for (const f of features) {
    const props = f.properties as any;
    if (props.STATEFP !== '06') continue;
    const fips = props.COUNTYFP as string;
    if (!BAY_AREA_COUNTY_FIPS.has(fips)) continue;
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    out.push({
      fips,
      slug: FIPS_TO_COUNTY_SLUG[fips],
      name: props.NAME as string,
      feature: f as Feature<Polygon | MultiPolygon>,
    });
  }
  console.log(`  loaded ${out.length} Bay Area county polygons`);
  return out;
}

async function loadCaliforniaPlaces(): Promise<Feature[]> {
  ensureTmpDir();
  const zipPath = join(TMP_DIR, 'tl_2022_06_place.zip');
  const unzipDir = join(TMP_DIR, 'place');
  await downloadIfMissing(PLACE_ZIP_URL, zipPath);
  if (!existsSync(join(unzipDir, 'tl_2022_06_place.shp'))) {
    unzipSafe(zipPath, unzipDir);
  }
  const features = await readShapefile(join(unzipDir, 'tl_2022_06_place.shp'));
  console.log(`  loaded ${features.length} California Places`);
  return features;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

async function main() {
  console.log('=== Fetch Census TIGER Places (California, Bay Area) ===\n');

  console.log('--- Step 1: Load Bay Area county polygons ---');
  const counties = await loadBayAreaCountyPolys();

  console.log('\n--- Step 2: Load California Places ---');
  const places = await loadCaliforniaPlaces();

  console.log('\n--- Step 3: Filter to Bay Area (bbox + county spatial join) ---');
  const kept: Feature[] = [];
  let bboxSkipped = 0;
  let noCountyMatch = 0;

  for (const place of places) {
    const geom = place.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    const poly = geom as Polygon | MultiPolygon;
    const bbox = geometryBbox(poly);
    if (!bboxIntersects(bbox)) { bboxSkipped++; continue; }

    // Compute centroid for county lookup
    const c = centroid(place as Feature<Polygon | MultiPolygon>);
    const [lng, lat] = c.geometry.coordinates;
    const cpt = point([lng, lat]);

    // Find county via PIP
    let matchedCounty: CountyPoly | null = null;
    for (const county of counties) {
      try {
        if (booleanPointInPolygon(cpt, county.feature)) {
          matchedCounty = county;
          break;
        }
      } catch {
        // Skip invalid geometry
      }
    }

    if (!matchedCounty) { noCountyMatch++; continue; }

    const props = place.properties as any;
    const name = props.NAME as string;
    const geoid = props.GEOID as string; // 7-digit: STATEFP(2)+PLACEFP(5)
    const placefp = props.PLACEFP as string;
    const classfp = props.CLASSFP as string;
    const nameLsad = props.NAMELSAD as string | undefined;

    kept.push({
      type: 'Feature',
      geometry: poly,
      properties: {
        placeId: `place:${geoid}`,
        GEOID: geoid,
        PLACEFP: placefp,
        CLASSFP: classfp,
        NAME: name,
        NAMELSAD: nameLsad ?? name,
        slug: slugify(name),
        county: matchedCounty.slug,
        countyName: matchedCounty.name,
        centroidLat: lat,
        centroidLng: lng,
      },
    });
  }

  console.log(`  kept ${kept.length} places in Bay Area`);
  console.log(`  bbox filtered out: ${bboxSkipped}`);
  console.log(`  no county match: ${noCountyMatch}`);

  // Breakdown by CLASSFP (C1=incorporated city, 25=CDP, etc.)
  const byClass = new Map<string, number>();
  for (const f of kept) {
    const c = (f.properties as any).CLASSFP as string;
    byClass.set(c, (byClass.get(c) || 0) + 1);
  }
  console.log('  by CLASSFP:');
  for (const [c, n] of Array.from(byClass.entries()).sort()) {
    console.log(`    ${c}: ${n}`);
  }

  // Breakdown by county
  const byCounty = new Map<string, number>();
  for (const f of kept) {
    const c = (f.properties as any).county as string;
    byCounty.set(c, (byCounty.get(c) || 0) + 1);
  }
  console.log('  by county:');
  for (const [c, n] of Array.from(byCounty.entries()).sort()) {
    console.log(`    ${c}: ${n}`);
  }

  const fc: FeatureCollection = { type: 'FeatureCollection', features: kept };
  const outPath = join(PROJECT_ROOT, 'public', 'bay-area-places-census.geojson');
  const json = JSON.stringify(fc);
  writeFileSync(outPath, json);
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`\nSaved to ${outPath} (${sizeMB} MB, ${kept.length} features)`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
