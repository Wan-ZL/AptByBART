/**
 * Fetch Census 2022 TIGER/Line Area Water for all 9 Bay Area counties and
 * merge into an authoritative GeoJSON at public/bay-area-water-census.geojson.
 *
 * Source pattern: https://www2.census.gov/geo/tiger/TIGER2022/AREAWATER/tl_2022_06<COUNTYFP>_areawater.zip
 *
 * Each county zip contains a shapefile of all water polygons (bays, lakes,
 * ponds, ocean portions, reservoirs) within that county boundary. The script
 * downloads all nine, reads each .shp with the `shapefile` npm module, tags
 * every feature with its county FIPS, and merges into a single
 * FeatureCollection.
 *
 * Idempotent — re-running skips downloads when zips already exist in /tmp.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
// @ts-ignore — shapefile has no published types
import * as shapefile from 'shapefile';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

const PROJECT_ROOT = resolve(__dirname, '..');
const TMP_DIR = '/tmp/aptbybart-tiger-water';

// 9 Bay Area county FIPS (California = state 06)
const BAY_AREA_COUNTIES: { fips: string; name: string }[] = [
  { fips: '001', name: 'Alameda' },
  { fips: '013', name: 'Contra Costa' },
  { fips: '041', name: 'Marin' },
  { fips: '055', name: 'Napa' },
  { fips: '075', name: 'San Francisco' },
  { fips: '081', name: 'San Mateo' },
  { fips: '085', name: 'Santa Clara' },
  { fips: '095', name: 'Solano' },
  { fips: '097', name: 'Sonoma' },
];

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

async function downloadIfMissing(url: string, localPath: string): Promise<number> {
  if (existsSync(localPath)) {
    const size = statSync(localPath).size;
    console.log(`  [cached] ${localPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
    return size;
  }
  console.log(`  [download] ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const file = createWriteStream(localPath);
  // @ts-ignore — Web stream → Node stream
  await pipeline(Readable.fromWeb(res.body), file);
  const size = statSync(localPath).size;
  console.log(`  [saved] ${localPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  return size;
}

function unzipSafe(zipPath: string, destDir: string) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`unzip failed (status=${r.status}) for ${zipPath}`);
}

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

// Simplify coordinate precision to 5 decimal places (~1m accuracy) to shrink
// the output file without noticeably affecting the clip.
function simplifyCoords(coords: unknown): unknown {
  if (typeof coords === 'number') return Math.round(coords * 100000) / 100000;
  if (Array.isArray(coords)) return coords.map(simplifyCoords);
  return coords;
}

async function main() {
  console.log('=== Fetch Census TIGER Area Water (Bay Area) ===\n');

  ensureTmpDir();

  const allFeatures: Feature[] = [];
  let totalDownloadedBytes = 0;
  const perCountyStats: { fips: string; name: string; bytes: number; features: number }[] = [];

  for (const county of BAY_AREA_COUNTIES) {
    const url = `https://www2.census.gov/geo/tiger/TIGER2022/AREAWATER/tl_2022_06${county.fips}_areawater.zip`;
    const zipPath = join(TMP_DIR, `tl_2022_06${county.fips}_areawater.zip`);
    const unzipDir = join(TMP_DIR, `county_${county.fips}`);
    const shpPath = join(unzipDir, `tl_2022_06${county.fips}_areawater.shp`);

    console.log(`\n--- County ${county.fips} (${county.name}) ---`);
    const bytes = await downloadIfMissing(url, zipPath);
    totalDownloadedBytes += bytes;

    if (!existsSync(shpPath)) {
      unzipSafe(zipPath, unzipDir);
    }

    const features = await readShapefile(shpPath);
    let countyFeatureCount = 0;
    for (const f of features) {
      const geom = f.geometry;
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
      const props = (f.properties as Record<string, unknown>) ?? {};
      allFeatures.push({
        type: 'Feature',
        geometry: {
          type: geom.type,
          coordinates: simplifyCoords((geom as Polygon | MultiPolygon).coordinates) as any,
        } as Polygon | MultiPolygon,
        properties: {
          countyFips: county.fips,
          countyName: county.name,
          HYDROID: props.HYDROID ?? null,
          FULLNAME: props.FULLNAME ?? null,
          MTFCC: props.MTFCC ?? null,
          AWATER: props.AWATER ?? null,
        },
      });
      countyFeatureCount++;
    }
    perCountyStats.push({
      fips: county.fips,
      name: county.name,
      bytes,
      features: countyFeatureCount,
    });
    console.log(`  read ${countyFeatureCount} water polygons`);
  }

  console.log('\n--- Per-county summary ---');
  for (const s of perCountyStats) {
    console.log(
      `  ${s.fips} ${s.name.padEnd(16)} ${(s.bytes / 1024 / 1024).toFixed(2).padStart(6)} MB  ${String(s.features).padStart(5)} features`
    );
  }
  console.log(
    `  TOTAL              ${(totalDownloadedBytes / 1024 / 1024).toFixed(2).padStart(6)} MB  ${String(allFeatures.length).padStart(5)} features`
  );

  const fc: FeatureCollection = { type: 'FeatureCollection', features: allFeatures };
  const outPath = join(PROJECT_ROOT, 'public', 'bay-area-water-census.geojson');
  const json = JSON.stringify(fc);
  writeFileSync(outPath, json);
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`\nSaved to ${outPath} (${sizeMB} MB, ${allFeatures.length} features)`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
