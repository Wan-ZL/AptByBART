import { writeFileSync } from 'fs';
import { join } from 'path';

const SF_NEIGHBORHOODS_URL =
  'https://data.sfgov.org/resource/j2bu-swwd.geojson?$limit=100';

function simplifyCoords(coords: unknown): unknown {
  if (typeof coords === 'number') return Math.round(coords * 100000) / 100000;
  if (Array.isArray(coords)) return coords.map(simplifyCoords);
  return coords;
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function main() {
  console.log('Fetching SF Analysis Neighborhoods from DataSF...\n');

  const res = await fetch(SF_NEIGHBORHOODS_URL);
  if (!res.ok) throw new Error(`DataSF returned ${res.status}: ${await res.text()}`);

  const geojson = await res.json();
  const features: any[] = [];

  for (const feature of geojson.features || []) {
    const nhood = feature.properties?.nhood;
    if (!nhood || !feature.geometry) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: feature.geometry.type,
        coordinates: simplifyCoords(feature.geometry.coordinates),
      },
      properties: {
        NAME: nhood,
        SLUG: toSlug(nhood),
      },
    });
  }

  const output = { type: 'FeatureCollection', features };
  const outPath = join(process.cwd(), 'public', 'sf-neighborhoods.geojson');
  const json = JSON.stringify(output);
  writeFileSync(outPath, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`Saved to ${outPath} (${sizeMB} MB, ${features.length} neighborhoods)\n`);

  const names = features.map(f => f.properties.NAME).sort();
  console.log(`Neighborhoods (${names.length}):`);
  for (const name of names) console.log(`  - ${name}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
