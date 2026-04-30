/**
 * Fetch Census Tract boundaries (TIGERweb) and ACS population data
 * for all 9 Bay Area counties and populate the geo_areas table.
 *
 * Every land tract is written to public/census-tracts.geojson so the
 * map can render choropleth polygons across the entire region. Tracts
 * whose centroid falls inside SF or Oakland are still excluded from
 * the city-level tract->city join (those regions use neighborhood/beat
 * data instead), but the polygons themselves are still emitted so the
 * map covers the whole Bay Area.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { db } from '../db/client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';

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

// County FIPS codes for all 9 Bay Area counties
const COUNTY_FIPS = ['001', '013', '041', '055', '075', '081', '085', '095', '097'];
// Alameda=001, Contra Costa=013, Marin=041, Napa=055, San Francisco=075,
// San Mateo=081, Santa Clara=085, Solano=095, Sonoma=097

// Map county FIPS -> geo_areas county id, used as fallback parent when a
// tract centroid does not land inside any known city polygon.
const COUNTY_PARENT_ID: Record<string, string> = {
  '001': 'county:alameda',
  '013': 'county:contra_costa',
  '041': 'county:marin',
  '055': 'county:napa',
  '075': 'county:san_francisco',
  '081': 'county:san_mateo',
  '085': 'county:santa_clara',
  '095': 'county:solano',
  '097': 'county:sonoma',
};

// Cities whose tracts should not be joined onto city rows (they use
// finer-grained neighborhood/beat data). Polygons are still emitted
// to the GeoJSON so the map has full coverage.
const EXCLUDE_CITIES = new Set(['San Francisco', 'Oakland']);

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function computeCentroid(geometry: any): { lat: number; lng: number } | null {
  const coords: number[][] = [];

  function extractCoords(c: any) {
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      coords.push(c);
    } else if (Array.isArray(c)) {
      for (const item of c) extractCoords(item);
    }
  }

  extractCoords(geometry.coordinates);
  if (coords.length === 0) return null;

  let sumLng = 0, sumLat = 0;
  for (const [lng, lat] of coords) {
    sumLng += lng;
    sumLat += lat;
  }
  return { lat: sumLat / coords.length, lng: sumLng / coords.length };
}

// Simplify coordinate precision to 5 decimal places (~1m accuracy)
function simplifyCoords(coords: unknown): unknown {
  if (typeof coords === 'number') return Math.round(coords * 100000) / 100000;
  if (Array.isArray(coords)) return coords.map(simplifyCoords);
  return coords;
}

interface TractFeature {
  type: 'Feature';
  geometry: any;
  properties: {
    GEOID: string;
    NAME: string;
    COUNTY: string;
    AREALAND: number;
    parentCity: string;
  };
}

/**
 * Fetch tract boundaries from TIGERweb REST API for one county.
 * Paginates with resultOffset if needed.
 */
async function fetchTractsForCounty(countyFips: string): Promise<any[]> {
  const baseUrl = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/8/query';
  const features: any[] = [];
  let offset = 0;
  const pageSize = 5000;

  while (true) {
    const params = new URLSearchParams({
      where: `STATE='06' AND COUNTY='${countyFips}'`,
      outFields: 'GEOID,NAME,COUNTY,AREALAND',
      f: 'geojson',
      outSR: '4326',
      returnGeometry: 'true',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });

    const url = `${baseUrl}?${params}`;
    console.log(`  Fetching county ${countyFips} offset=${offset}...`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`TIGERweb returned ${res.status} for county ${countyFips}: ${await res.text()}`);
    }

    const data = await res.json();
    const pageFeatures = data.features || [];
    features.push(...pageFeatures);

    console.log(`    Got ${pageFeatures.length} tracts (total: ${features.length})`);

    if (pageFeatures.length < pageSize) break;
    offset += pageSize;
  }

  return features;
}

/**
 * Fetch ACS 2023 5-year population data from Census API.
 * Returns a Map of GEOID -> population.
 */
async function fetchAcsPopulation(): Promise<Map<string, number>> {
  const url = 'https://api.census.gov/data/2023/acs/acs5?get=B01003_001E,NAME&for=tract:*&in=state:06+county:' +
    COUNTY_FIPS.join(',');

  console.log('Fetching ACS population data...');
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Census API returned ${res.status}: ${await res.text()}`);
  }

  const rows: string[][] = await res.json();
  // First row is headers: ["B01003_001E","NAME","state","county","tract"]
  const popMap = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const [popStr, , state, county, tract] = rows[i];
    const geoid = `${state}${county}${tract}`;
    const pop = parseInt(popStr, 10);
    if (!isNaN(pop) && pop >= 0) {
      popMap.set(geoid, pop);
    }
  }

  console.log(`  Loaded population for ${popMap.size} tracts`);
  return popMap;
}

async function main() {
  console.log('=== Fetch Census Tracts ===\n');

  // 1. Fetch tract boundaries from TIGERweb (one query per county)
  console.log('--- Step 1: Fetch tract boundaries ---');
  const allTractFeatures: any[] = [];

  for (const county of COUNTY_FIPS) {
    const features = await fetchTractsForCounty(county);
    allTractFeatures.push(...features);
  }
  console.log(`Total raw tracts fetched: ${allTractFeatures.length}\n`);

  // 2. Fetch ACS population data
  console.log('--- Step 2: Fetch ACS population ---');
  const popMap = await fetchAcsPopulation();
  console.log();

  // 3. Load city boundary polygons from authoritative Census TIGER Places.
  //    Includes both incorporated cities (CLASSFP=C1) and Census Designated
  //    Places (CLASSFP=U1/U2), so tracts inside CDPs get a place-level parent
  //    instead of falling back to the county.
  console.log('--- Step 3: Load city boundaries (Census TIGER Places) ---');
  const citiesPath = resolve(__dirname, '..', 'public', 'bay-area-places-census.geojson');
  const citiesGeoJson = JSON.parse(readFileSync(citiesPath, 'utf-8'));
  const cityFeatures: any[] = citiesGeoJson.features || [];
  console.log(`  Loaded ${cityFeatures.length} Census Place boundaries\n`);

  // 4. For each tract, determine parent city via centroid point-in-polygon.
  //    Fallback to the county name when a tract lies outside all known city
  //    polygons (common for unincorporated land in Napa, Sonoma, Marin).
  //    SF and Oakland tracts keep `parentCity` so they still render as
  //    polygons, but they are tagged so the downstream tract->city
  //    population join can skip them.
  console.log('--- Step 4: Assign tracts to cities ---');
  const filteredTracts: TractFeature[] = [];
  let waterOnly = 0;
  let noCity = 0;
  let excludedSfOak = 0;

  // Friendly county name lookup for the fallback parentCity value.
  const COUNTY_DISPLAY_NAME: Record<string, string> = {
    '001': 'Alameda County',
    '013': 'Contra Costa County',
    '041': 'Marin County',
    '055': 'Napa County',
    '075': 'San Francisco County',
    '081': 'San Mateo County',
    '085': 'Santa Clara County',
    '095': 'Solano County',
    '097': 'Sonoma County',
  };

  for (const feature of allTractFeatures) {
    const props = feature.properties || {};
    const arealand = props.AREALAND ?? props.arealand ?? 0;

    // Skip water-only tracts
    if (arealand === 0) {
      waterOnly++;
      continue;
    }

    const centroid = computeCentroid(feature.geometry);
    if (!centroid) continue;

    // Point-in-polygon test against city boundaries
    const pt = turfPoint([centroid.lng, centroid.lat]);
    let parentCity: string | null = null;

    for (const cityFeature of cityFeatures) {
      try {
        if (booleanPointInPolygon(pt, cityFeature.geometry)) {
          parentCity = cityFeature.properties.NAME;
          break;
        }
      } catch {
        // Invalid geometry — skip
      }
    }

    const geoid = props.GEOID || props.geoid || '';
    const name = props.NAME || props.name || `Tract ${geoid}`;
    const county = props.COUNTY || props.county || '';

    if (!parentCity) {
      parentCity = COUNTY_DISPLAY_NAME[county] ?? 'Bay Area';
      noCity++;
    } else if (EXCLUDE_CITIES.has(parentCity)) {
      // SF and Oakland tracts are still emitted (so polygons render),
      // but the tract->city population join below skips them.
      excludedSfOak++;
    }

    filteredTracts.push({
      type: 'Feature',
      geometry: {
        type: feature.geometry.type,
        coordinates: simplifyCoords(feature.geometry.coordinates),
      },
      properties: {
        GEOID: geoid,
        NAME: name,
        COUNTY: county,
        AREALAND: arealand,
        parentCity,
      },
    });
  }

  console.log(`  Water-only tracts skipped: ${waterOnly}`);
  console.log(`  No city match (assigned to county): ${noCity}`);
  console.log(`  SF/Oakland tracts emitted (join skipped): ${excludedSfOak}`);
  console.log(`  Tracts kept: ${filteredTracts.length}\n`);

  // Count per city
  const cityCount = new Map<string, number>();
  for (const t of filteredTracts) {
    const c = t.properties.parentCity;
    cityCount.set(c, (cityCount.get(c) || 0) + 1);
  }
  console.log('  Tracts per city:');
  for (const [city, count] of Array.from(cityCount.entries()).sort()) {
    console.log(`    ${city}: ${count}`);
  }
  console.log();

  // 5. Write filtered tract GeoJSON
  console.log('--- Step 5: Write census-tracts.geojson ---');
  const outputGeoJson = {
    type: 'FeatureCollection',
    features: filteredTracts,
  };
  const outPath = join(process.cwd(), 'public', 'census-tracts.geojson');
  const json = JSON.stringify(outputGeoJson);
  writeFileSync(outPath, json);
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`  Saved to ${outPath} (${sizeMB} MB, ${filteredTracts.length} tracts)\n`);

  // 6. Upsert tract records into geo_areas. Parent is the matching city
  //    when the tract centroid falls inside a known city polygon, else
  //    the county-level geo_area (so unincorporated / SF / Oakland tracts
  //    still have a valid parent chain).
  console.log('--- Step 6: Upsert tracts into geo_areas ---');
  let tractUpserted = 0;

  // Build a set of valid city geo_area ids so we only point at ones that
  // actually exist; everything else falls through to the county.
  const cityIdRows = await db.execute("SELECT id FROM geo_areas WHERE area_type = 'city'");
  const existingCityIds = new Set(cityIdRows.rows.map((r) => r.id as string));

  for (const tract of filteredTracts) {
    const geoid = tract.properties.GEOID;
    const name = tract.properties.NAME;
    const parentCity = tract.properties.parentCity;
    const county = tract.properties.COUNTY;
    const countyParent = COUNTY_PARENT_ID[county] ?? null;

    const candidateCityId = `city:${toSlug(parentCity)}`;
    const parentAreaId = existingCityIds.has(candidateCityId)
      ? candidateCityId
      : countyParent;

    const centroid = computeCentroid(tract.geometry);
    const pop = popMap.get(geoid) ?? null;

    await db.execute({
      sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population)
            VALUES (?, ?, 'tract', ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              population = excluded.population,
              centroid_lat = excluded.centroid_lat,
              centroid_lng = excluded.centroid_lng,
              parent_area_id = excluded.parent_area_id`,
      args: [
        `tract:${geoid}`,
        name,
        parentAreaId,
        centroid?.lat ?? null,
        centroid?.lng ?? null,
        pop,
      ],
    });
    tractUpserted++;
  }
  console.log(`  Upserted ${tractUpserted} tract geo_areas\n`);

  // 7. Update SF neighborhood populations by spatial aggregation
  console.log('--- Step 7: Update SF neighborhood populations ---');
  const sfPath = resolve(__dirname, '..', 'public', 'sf-neighborhoods.geojson');
  const sfGeoJson = JSON.parse(readFileSync(sfPath, 'utf-8'));
  const sfFeatures: any[] = sfGeoJson.features || [];

  // Get all SF county tracts (county 075)
  const sfTracts = allTractFeatures.filter((f: any) => {
    const county = f.properties?.COUNTY || f.properties?.county || '';
    return county === '075';
  });

  let sfNeighborhoodsUpdated = 0;
  for (const nFeature of sfFeatures) {
    const slug = nFeature.properties.SLUG;
    const nName = nFeature.properties.NAME;
    let totalPop = 0;
    let tractCount = 0;

    for (const tract of sfTracts) {
      const geoid = tract.properties?.GEOID || tract.properties?.geoid || '';
      const centroid = computeCentroid(tract.geometry);
      if (!centroid) continue;

      const pt = turfPoint([centroid.lng, centroid.lat]);
      try {
        if (booleanPointInPolygon(pt, nFeature.geometry)) {
          const pop = popMap.get(geoid) || 0;
          totalPop += pop;
          tractCount++;
        }
      } catch {
        // Invalid geometry
      }
    }

    if (totalPop > 0) {
      await db.execute({
        sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
        args: [totalPop, `neighborhood:${slug}`],
      });
      sfNeighborhoodsUpdated++;
      console.log(`  neighborhood:${slug} (${nName}): ${totalPop} (${tractCount} tracts)`);
    }
  }
  console.log(`  Updated ${sfNeighborhoodsUpdated} SF neighborhoods\n`);

  // 8. Update Oakland beat populations by spatial aggregation
  console.log('--- Step 8: Update Oakland beat populations ---');
  const oakPath = resolve(__dirname, '..', 'public', 'oakland-beats.geojson');
  const oakGeoJson = JSON.parse(readFileSync(oakPath, 'utf-8'));
  const oakFeatures: any[] = oakGeoJson.features || [];

  // Get all Alameda county tracts (county 001) for Oakland
  const alamedaTracts = allTractFeatures.filter((f: any) => {
    const county = f.properties?.COUNTY || f.properties?.county || '';
    return county === '001';
  });

  let oakBeatsUpdated = 0;
  for (const bFeature of oakFeatures) {
    const slug = bFeature.properties.SLUG;
    const bName = bFeature.properties.NAME;
    let totalPop = 0;
    let tractCount = 0;

    for (const tract of alamedaTracts) {
      const geoid = tract.properties?.GEOID || tract.properties?.geoid || '';
      const centroid = computeCentroid(tract.geometry);
      if (!centroid) continue;

      const pt = turfPoint([centroid.lng, centroid.lat]);
      try {
        if (booleanPointInPolygon(pt, bFeature.geometry)) {
          const pop = popMap.get(geoid) || 0;
          totalPop += pop;
          tractCount++;
        }
      } catch {
        // Invalid geometry
      }
    }

    if (totalPop > 0) {
      await db.execute({
        sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
        args: [totalPop, `beat:${slug}`],
      });
      oakBeatsUpdated++;
      console.log(`  beat:${slug} (${bName}): ${totalPop} (${tractCount} tracts)`);
    }
  }
  console.log(`  Updated ${oakBeatsUpdated} Oakland beats\n`);

  // 9. Update city-level populations by summing tract populations
  console.log('--- Step 9: Update city populations ---');

  // Aggregate all tract populations (including SF/Oakland tracts) per city
  const cityPops = new Map<string, number>();

  for (const feature of allTractFeatures) {
    const props = feature.properties || {};
    const arealand = props.AREALAND ?? props.arealand ?? 0;
    if (arealand === 0) continue;

    const geoid = props.GEOID || props.geoid || '';
    const pop = popMap.get(geoid) || 0;
    if (pop === 0) continue;

    const centroid = computeCentroid(feature.geometry);
    if (!centroid) continue;

    const pt = turfPoint([centroid.lng, centroid.lat]);
    for (const cityFeature of cityFeatures) {
      try {
        if (booleanPointInPolygon(pt, cityFeature.geometry)) {
          const cityName = cityFeature.properties.NAME;
          cityPops.set(cityName, (cityPops.get(cityName) || 0) + pop);
          break;
        }
      } catch {
        // Invalid geometry
      }
    }
  }

  let citiesUpdated = 0;
  for (const [city, pop] of Array.from(cityPops.entries())) {
    const id = `city:${toSlug(city)}`;
    const result = await db.execute({
      sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
      args: [pop, id],
    });
    if ((result.rowsAffected ?? 0) > 0) {
      citiesUpdated++;
      console.log(`  ${id}: ${pop.toLocaleString()}`);
    }
  }
  console.log(`  Updated ${citiesUpdated} city populations\n`);

  // Summary
  const totalGeo = await db.execute("SELECT COUNT(*) as cnt FROM geo_areas WHERE area_type = 'tract'");
  console.log(`--- Summary ---`);
  console.log(`  Total tract geo_areas in DB: ${totalGeo.rows[0].cnt}`);
  console.log(`  Census tracts GeoJSON: ${filteredTracts.length} features`);
  console.log(`  SF neighborhoods updated: ${sfNeighborhoodsUpdated}`);
  console.log(`  Oakland beats updated: ${oakBeatsUpdated}`);
  console.log(`  Cities updated: ${citiesUpdated}`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
