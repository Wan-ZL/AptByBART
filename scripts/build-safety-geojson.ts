/**
 * Merge all boundary GeoJSON files into a single unified-safety.geojson.
 * Combines SF neighborhoods, Oakland beats, and census tracts with
 * consistent properties and population data from the geo_areas table.
 *
 * Output order: tracts first, then neighborhoods/beats (so finer-grained
 * areas render on top in MapLibre).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { db } from '../db/client';

// Load .env.local manually (no dotenv dependency)
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
  // .env.local not found — rely on environment variables
}

interface UnifiedFeature {
  type: 'Feature';
  geometry: any;
  properties: {
    areaId: string;
    areaName: string;
    areaType: 'neighborhood' | 'beat' | 'tract';
    parentCity: string;
    population: number;
  };
}

async function main() {
  console.log('=== Build Unified Safety GeoJSON ===\n');

  const publicDir = resolve(__dirname, '..', 'public');

  // 1. Load all 3 GeoJSON files
  console.log('--- Step 1: Load source GeoJSON files ---');

  const sfPath = resolve(publicDir, 'sf-neighborhoods.geojson');
  const oakPath = resolve(publicDir, 'oakland-beats.geojson');
  const tractsPath = resolve(publicDir, 'census-tracts.geojson');

  if (!existsSync(sfPath)) throw new Error(`Missing ${sfPath}`);
  if (!existsSync(oakPath)) throw new Error(`Missing ${oakPath}`);
  if (!existsSync(tractsPath)) throw new Error(`Missing ${tractsPath} — run fetch-census-tracts first`);

  const sfGeoJson = JSON.parse(readFileSync(sfPath, 'utf-8'));
  const oakGeoJson = JSON.parse(readFileSync(oakPath, 'utf-8'));
  const tractsGeoJson = JSON.parse(readFileSync(tractsPath, 'utf-8'));

  const sfFeatures: any[] = sfGeoJson.features || [];
  const oakFeatures: any[] = oakGeoJson.features || [];
  const tractFeatures: any[] = tractsGeoJson.features || [];

  console.log(`  SF neighborhoods: ${sfFeatures.length}`);
  console.log(`  Oakland beats: ${oakFeatures.length}`);
  console.log(`  Census tracts: ${tractFeatures.length}\n`);

  // 2. Query population data from geo_areas
  console.log('--- Step 2: Load population data from geo_areas ---');
  const popResult = await db.execute('SELECT id, population FROM geo_areas WHERE population IS NOT NULL');
  const popMap = new Map<string, number>();
  for (const row of popResult.rows) {
    popMap.set(row.id as string, row.population as number);
  }
  console.log(`  Loaded population for ${popMap.size} geo_areas\n`);

  // 3. Process SF neighborhoods
  console.log('--- Step 3: Process SF neighborhoods ---');
  const sfUnified: UnifiedFeature[] = [];
  for (const feature of sfFeatures) {
    const slug = feature.properties.SLUG;
    const name = feature.properties.NAME;
    const areaId = `neighborhood:${slug}`;

    sfUnified.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        areaId,
        areaName: name,
        areaType: 'neighborhood',
        parentCity: 'San Francisco',
        population: popMap.get(areaId) ?? 0,
      },
    });
  }
  console.log(`  Processed ${sfUnified.length} neighborhoods`);

  // 4. Process Oakland beats
  console.log('--- Step 4: Process Oakland beats ---');
  const oakUnified: UnifiedFeature[] = [];
  for (const feature of oakFeatures) {
    const slug = feature.properties.SLUG;
    const name = feature.properties.NAME;
    const areaId = `beat:${slug}`;

    oakUnified.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        areaId,
        areaName: name,
        areaType: 'beat',
        parentCity: 'Oakland',
        population: popMap.get(areaId) ?? 0,
      },
    });
  }
  console.log(`  Processed ${oakUnified.length} beats`);

  // 5. Process census tracts
  console.log('--- Step 5: Process census tracts ---');
  const tractUnified: UnifiedFeature[] = [];
  for (const feature of tractFeatures) {
    const geoid = feature.properties.GEOID;
    const name = feature.properties.NAME;
    const parentCity = feature.properties.parentCity;
    const areaId = `tract:${geoid}`;

    tractUnified.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        areaId,
        areaName: name,
        areaType: 'tract',
        parentCity,
        population: popMap.get(areaId) ?? 0,
      },
    });
  }
  console.log(`  Processed ${tractUnified.length} tracts`);

  // 6. Concatenate: tracts FIRST, then neighborhoods/beats (render on top)
  console.log('\n--- Step 6: Merge and write ---');
  const allFeatures: UnifiedFeature[] = [
    ...tractUnified,
    ...sfUnified,
    ...oakUnified,
  ];

  const output = {
    type: 'FeatureCollection',
    features: allFeatures,
  };

  const outPath = join(process.cwd(), 'public', 'unified-safety.geojson');
  const json = JSON.stringify(output);
  writeFileSync(outPath, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`  Saved to ${outPath} (${sizeMB} MB)`);

  // Summary
  console.log('\n--- Summary ---');
  console.log(`  Total features: ${allFeatures.length}`);
  console.log(`    Tracts: ${tractUnified.length}`);
  console.log(`    SF neighborhoods: ${sfUnified.length}`);
  console.log(`    Oakland beats: ${oakUnified.length}`);

  // Count features with population > 0
  const withPop = allFeatures.filter(f => f.properties.population > 0).length;
  console.log(`  Features with population data: ${withPop}/${allFeatures.length}`);

  // List parent cities
  const cities = new Set(allFeatures.map(f => f.properties.parentCity));
  console.log(`  Cities represented: ${cities.size}`);
  for (const city of Array.from(cities).sort()) {
    const count = allFeatures.filter(f => f.properties.parentCity === city).length;
    console.log(`    ${city}: ${count}`);
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
