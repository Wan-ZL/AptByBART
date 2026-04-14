import { writeFileSync } from 'fs';
import { join } from 'path';

const OAKLAND_BEATS_URLS = [
  'https://data.oaklandca.gov/resource/78s7-673i.geojson?$limit=100',
];

function simplifyCoords(coords: unknown): unknown {
  if (typeof coords === 'number') return Math.round(coords * 100000) / 100000;
  if (Array.isArray(coords)) return coords.map(simplifyCoords);
  return coords;
}

function extractBeatId(props: Record<string, any>): string | null {
  // Try common property names for beat identifier
  for (const key of ['beat', 'BEAT', 'policebeat', 'POLICEBEAT', 'police_beat', 'POLICE_BEAT', 'name', 'NAME']) {
    if (props[key]) return String(props[key]).trim();
  }
  return null;
}

async function main() {
  console.log('Fetching Oakland Police Beats...\n');

  let geojson: any = null;
  for (const url of OAKLAND_BEATS_URLS) {
    try {
      console.log(`Trying: ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  Got ${res.status}, skipping`);
        continue;
      }
      geojson = await res.json();
      console.log(`  Success!`);
      break;
    } catch (err: any) {
      console.warn(`  Failed: ${err.message}`);
    }
  }

  if (!geojson) throw new Error('All Oakland beat sources failed');

  // Log first feature's properties to understand the schema
  if (geojson.features?.[0]) {
    console.log('\nSample properties:', JSON.stringify(geojson.features[0].properties, null, 2));
  }

  const features: any[] = [];
  for (const feature of geojson.features || []) {
    const beatId = extractBeatId(feature.properties || {});
    if (!beatId || !feature.geometry) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: feature.geometry.type,
        coordinates: simplifyCoords(feature.geometry.coordinates),
      },
      properties: {
        NAME: beatId,
        SLUG: beatId.toLowerCase(),
      },
    });
  }

  const output = { type: 'FeatureCollection', features };
  const outPath = join(process.cwd(), 'public', 'oakland-beats.geojson');
  const json = JSON.stringify(output);
  writeFileSync(outPath, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`\nSaved to ${outPath} (${sizeMB} MB, ${features.length} beats)\n`);

  const names = features.map(f => f.properties.NAME).sort();
  console.log(`Beats (${names.length}):`);
  for (const name of names) console.log(`  - ${name}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
