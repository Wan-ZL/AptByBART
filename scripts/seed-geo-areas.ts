import { readFileSync } from 'fs';
import { resolve } from 'path';
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

// Station → City mapping (same as ingest-crime.ts)
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

// US Census 2020 estimates for cities near BART
const CITY_POPULATIONS: Record<string, number> = {
  'San Francisco': 873965,
  'Oakland': 433031,
  'San Jose': 1013240,
  'Berkeley': 124321,
  'Fremont': 230504,
  'Hayward': 162954,
  'Richmond': 116448,
  'Concord': 129295,
  'Daly City': 104901,
  'San Leandro': 91799,
  'Walnut Creek': 69122,
  'Dublin': 72589,
  'Milpitas': 80430,
  'Pittsburg': 75024,
  'Antioch': 115291,
  'Union City': 78637,
  'Pleasant Hill': 34903,
  'El Cerrito': 25280,
  'Orinda': 19850,
  'Lafayette': 25949,
  'South San Francisco': 67789,
  'San Bruno': 44663,
  'Millbrae': 24311,
};

// Approximate SF neighborhood populations (distributed from SF total)
const SF_NEIGHBORHOOD_POPULATIONS: Record<string, number> = {
  'Mission': 45000,
  'Tenderloin': 28000,
  'South of Market': 40000,
  'Financial District/South Beach': 18000,
  'Bayview Hunters Point': 37000,
  'Western Addition': 25000,
  'Sunset/Parkside': 85000,
  'Richmond': 50000,
  'Nob Hill': 22000,
  'Marina': 25000,
  'Castro/Upper Market': 18000,
  'Hayes Valley': 12000,
  'Chinatown': 15000,
  'North Beach': 12000,
  'Pacific Heights': 22000,
  'Potrero Hill': 14000,
  'Bernal Heights': 26000,
  'Excelsior': 40000,
  'Visitacion Valley': 22000,
  'Outer Mission': 22000,
  'Inner Sunset': 30000,
  'Outer Richmond': 30000,
  'Inner Richmond': 25000,
  'Glen Park': 12000,
  'Noe Valley': 18000,
  'Twin Peaks': 8000,
  'Haight Ashbury': 15000,
  'Russian Hill': 16000,
  'Lakeshore': 15000,
  'Oceanview/Merced/Ingleside': 30000,
  'West of Twin Peaks': 20000,
  'Portola': 15000,
  'Treasure Island': 3000,
  'Presidio Heights': 10000,
  'Japantown': 5000,
  'Lone Mountain/USF': 12000,
  'Presidio': 3000,
  'Seacliff': 3000,
  'McLaren Park': 5000,
  'Lincoln Park': 1000,
  'Golden Gate Park': 500,
};

// Average Oakland beat population (~433,031 / 35 beats)
const OAKLAND_BEAT_DEFAULT_POPULATION = 12372;

// 2020 Census — state of California
const STATE_POPULATION = 39538223;

// 2020 Census — 9 Bay Area counties
const COUNTIES: Array<{ slug: string; name: string; population: number }> = [
  { slug: 'alameda', name: 'Alameda', population: 1682353 },
  { slug: 'contra_costa', name: 'Contra Costa', population: 1165927 },
  { slug: 'marin', name: 'Marin', population: 260266 },
  { slug: 'napa', name: 'Napa', population: 138019 },
  { slug: 'san_francisco', name: 'San Francisco', population: 873965 },
  { slug: 'san_mateo', name: 'San Mateo', population: 764442 },
  { slug: 'santa_clara', name: 'Santa Clara', population: 1936259 },
  { slug: 'solano', name: 'Solano', population: 453491 },
  { slug: 'sonoma', name: 'Sonoma', population: 488863 },
];

// City slug → county slug. Supports both underscore and dash variants
// (dashes appear on auto-created city rows from ingest).
const COUNTY_CITIES: Record<string, string[]> = {
  alameda: [
    'oakland', 'berkeley', 'fremont', 'hayward', 'pleasanton', 'livermore',
    'dublin', 'san_leandro', 'alameda', 'union_city', 'newark', 'albany',
    'emeryville', 'piedmont', 'castro_valley', 'san_lorenzo', 'ashland',
    'cherryland', 'sunol', 'fairview',
  ],
  contra_costa: [
    'richmond', 'concord', 'walnut_creek', 'antioch', 'pittsburg',
    'pleasant_hill', 'martinez', 'san_ramon', 'danville', 'lafayette',
    'orinda', 'moraga', 'hercules', 'pinole', 'el_cerrito', 'san_pablo',
    'brentwood', 'oakley',
  ],
  marin: [
    'san_rafael', 'novato', 'sausalito', 'mill_valley', 'tiburon',
    'larkspur', 'corte_madera',
  ],
  napa: [
    'napa', 'american_canyon', 'calistoga', 'st_helena', 'yountville',
  ],
  san_francisco: ['san_francisco'],
  san_mateo: [
    'san_mateo', 'daly_city', 'redwood_city', 'south_san_francisco',
    'san_bruno', 'burlingame', 'millbrae', 'belmont', 'foster_city',
    'san_carlos', 'hillsborough', 'menlo_park', 'atherton',
    'east_palo_alto', 'half_moon_bay', 'portola_valley', 'woodside',
    'brisbane', 'colma', 'pacifica',
  ],
  santa_clara: [
    'san_jose', 'sunnyvale', 'santa_clara', 'mountain_view', 'palo_alto',
    'milpitas', 'cupertino', 'saratoga', 'campbell', 'los_gatos', 'gilroy',
    'morgan_hill', 'los_altos', 'los_altos_hills', 'monte_sereno',
  ],
  solano: [
    'vallejo', 'fairfield', 'vacaville', 'benicia', 'suisun_city', 'dixon',
    'rio_vista',
  ],
  sonoma: [
    'santa_rosa', 'petaluma', 'rohnert_park', 'healdsburg', 'sonoma',
    'windsor', 'sebastopol', 'cotati',
  ],
};

const CITY_TO_COUNTY: Record<string, string> = {};
for (const [countySlug, cities] of Object.entries(COUNTY_CITIES)) {
  for (const citySlug of cities) {
    CITY_TO_COUNTY[citySlug] = countySlug;
    CITY_TO_COUNTY[citySlug.replace(/_/g, '-')] = countySlug;
  }
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function cityParentCounty(citySlug: string): string | null {
  const normalized = citySlug.replace(/-/g, '_');
  const county = CITY_TO_COUNTY[citySlug] ?? CITY_TO_COUNTY[normalized];
  return county ? `county:${county}` : null;
}

interface GeoFeature {
  type: string;
  geometry: any;
  properties: { NAME: string; SLUG: string };
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

async function main() {
  console.log('Seeding geo_areas table...\n');

  // 0. Seed state:california (root of the hierarchy)
  console.log('--- State geo_area ---');
  await db.execute({
    sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population)
          VALUES (?, ?, 'state', NULL, NULL, NULL, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            area_type = 'state',
            parent_area_id = NULL,
            population = excluded.population`,
    args: ['state:california', 'California', STATE_POPULATION],
  });
  console.log(`  state:california — California (pop ${STATE_POPULATION})`);

  // 0b. Seed all 9 Bay Area counties with parent=state:california
  console.log(`\n--- Counties (${COUNTIES.length}) ---`);
  for (const county of COUNTIES) {
    const id = `county:${county.slug}`;
    await db.execute({
      sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population)
            VALUES (?, ?, 'county', 'state:california', NULL, NULL, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              area_type = 'county',
              parent_area_id = 'state:california',
              population = excluded.population`,
      args: [id, county.name, county.population],
    });
    console.log(`  ${id} — ${county.name} (pop ${county.population})`);
  }

  // Defensive: any pre-existing county rows should also chain to state
  await db.execute({
    sql: `UPDATE geo_areas SET parent_area_id = 'state:california'
          WHERE area_type = 'county' AND parent_area_id IS NULL`,
    args: [],
  });

  // 1. Seed city-level geo_areas from STATION_CITY, each wired to its county
  const cities = [...new Set(Object.values(STATION_CITY))];
  console.log(`\n--- City-level geo_areas (${cities.length} cities) ---`);

  // Fetch station coordinates for computing city centroids
  const stationsResult = await db.execute('SELECT id, lat, lng FROM bart_stations');
  const stationCoords = new Map<string, { lat: number; lng: number }>();
  for (const row of stationsResult.rows) {
    stationCoords.set(row.id as string, { lat: row.lat as number, lng: row.lng as number });
  }

  for (const city of cities) {
    const slug = toSlug(city);
    const id = `city:${slug}`;
    const parentId = cityParentCounty(slug);

    // Compute centroid from station averages
    const stationsInCity = Object.entries(STATION_CITY)
      .filter(([, c]) => c === city)
      .map(([s]) => stationCoords.get(s))
      .filter(Boolean) as { lat: number; lng: number }[];

    let centroidLat: number | null = null;
    let centroidLng: number | null = null;
    if (stationsInCity.length > 0) {
      centroidLat = stationsInCity.reduce((s, c) => s + c.lat, 0) / stationsInCity.length;
      centroidLng = stationsInCity.reduce((s, c) => s + c.lng, 0) / stationsInCity.length;
    }

    await db.execute({
      sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng)
            VALUES (?, ?, 'city', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              area_type = 'city',
              parent_area_id = COALESCE(excluded.parent_area_id, geo_areas.parent_area_id),
              centroid_lat = COALESCE(excluded.centroid_lat, geo_areas.centroid_lat),
              centroid_lng = COALESCE(excluded.centroid_lng, geo_areas.centroid_lng)`,
      args: [id, city, parentId, centroidLat, centroidLng],
    });
    console.log(`  ${id} — ${city}${parentId ? ` → ${parentId}` : ' (no county mapped)'}`);
  }

  // Defensive: retrofit parent_area_id for any city rows already in DB (e.g.
  // auto-created by ingest with dash slugs) that we can map to a county.
  const allCities = await db.execute("SELECT id FROM geo_areas WHERE area_type = 'city' AND parent_area_id IS NULL");
  let retrofitCount = 0;
  for (const row of allCities.rows) {
    const cityId = row.id as string;
    const slug = cityId.replace(/^city:/, '');
    const parentId = cityParentCounty(slug);
    if (!parentId) continue;
    await db.execute({
      sql: 'UPDATE geo_areas SET parent_area_id = ? WHERE id = ?',
      args: [parentId, cityId],
    });
    retrofitCount++;
  }
  if (retrofitCount > 0) {
    console.log(`  Retrofitted ${retrofitCount} existing cities with county parent`);
  }

  // 2. Seed SF neighborhood geo_areas
  const sfPath = resolve(__dirname, '..', 'public', 'sf-neighborhoods.geojson');
  const sfGeoJson = JSON.parse(readFileSync(sfPath, 'utf-8'));
  const sfFeatures: GeoFeature[] = sfGeoJson.features;
  console.log(`\n--- SF neighborhood geo_areas (${sfFeatures.length} neighborhoods) ---`);

  for (const feature of sfFeatures) {
    const id = `neighborhood:${feature.properties.SLUG}`;
    const centroid = computeCentroid(feature.geometry);

    await db.execute({
      sql: `INSERT OR REPLACE INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng)
            VALUES (?, ?, 'neighborhood', 'city:san_francisco', ?, ?)`,
      args: [id, feature.properties.NAME, centroid?.lat ?? null, centroid?.lng ?? null],
    });
    console.log(`  ${id} — ${feature.properties.NAME}`);
  }

  // 3. Seed Oakland beat geo_areas
  const oakPath = resolve(__dirname, '..', 'public', 'oakland-beats.geojson');
  const oakGeoJson = JSON.parse(readFileSync(oakPath, 'utf-8'));
  const oakFeatures: GeoFeature[] = oakGeoJson.features;
  console.log(`\n--- Oakland beat geo_areas (${oakFeatures.length} beats) ---`);

  for (const feature of oakFeatures) {
    const id = `beat:${feature.properties.SLUG}`;
    const centroid = computeCentroid(feature.geometry);

    await db.execute({
      sql: `INSERT OR REPLACE INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng)
            VALUES (?, ?, 'beat', 'city:oakland', ?, ?)`,
      args: [id, feature.properties.NAME, centroid?.lat ?? null, centroid?.lng ?? null],
    });
    console.log(`  ${id} — ${feature.properties.NAME}`);
  }

  // 4. Map stations to geo_areas (city level)
  console.log('\n--- Mapping stations to geo_areas ---');
  let stationMapped = 0;
  for (const [stationId, city] of Object.entries(STATION_CITY)) {
    const geoAreaId = `city:${toSlug(city)}`;
    await db.execute({
      sql: `INSERT OR REPLACE INTO station_geo_areas (station_id, geo_area_id) VALUES (?, ?)`,
      args: [stationId, geoAreaId],
    });
    stationMapped++;
  }
  console.log(`  Mapped ${stationMapped} stations to their city geo_areas`);

  // 5. Map apartments to geo_areas
  console.log('\n--- Mapping apartments to geo_areas ---');
  const aptsResult = await db.execute('SELECT id, lat, lng, nearest_station_id FROM apartments');
  let aptCityMapped = 0;
  let aptNeighborhoodMapped = 0;
  let aptBeatMapped = 0;

  for (const apt of aptsResult.rows) {
    const aptId = apt.id as number;
    const aptLat = apt.lat as number;
    const aptLng = apt.lng as number;
    const nearestStation = apt.nearest_station_id as string | null;

    // Map to city via nearest station
    if (nearestStation && STATION_CITY[nearestStation]) {
      const citySlug = toSlug(STATION_CITY[nearestStation]);
      await db.execute({
        sql: `INSERT OR REPLACE INTO apartment_geo_areas (apartment_id, geo_area_id) VALUES (?, ?)`,
        args: [aptId, `city:${citySlug}`],
      });
      aptCityMapped++;

      // For SF apartments: map to neighborhood via point-in-polygon
      if (STATION_CITY[nearestStation] === 'San Francisco') {
        const pt = turfPoint([aptLng, aptLat]);
        for (const feature of sfFeatures) {
          try {
            if (booleanPointInPolygon(pt, feature.geometry)) {
              await db.execute({
                sql: `INSERT OR REPLACE INTO apartment_geo_areas (apartment_id, geo_area_id) VALUES (?, ?)`,
                args: [aptId, `neighborhood:${feature.properties.SLUG}`],
              });
              aptNeighborhoodMapped++;
              break;
            }
          } catch {
            // Invalid geometry — skip
          }
        }
      }

      // For Oakland apartments: map to beat via point-in-polygon
      if (STATION_CITY[nearestStation] === 'Oakland') {
        const pt = turfPoint([aptLng, aptLat]);
        for (const feature of oakFeatures) {
          try {
            if (booleanPointInPolygon(pt, feature.geometry)) {
              await db.execute({
                sql: `INSERT OR REPLACE INTO apartment_geo_areas (apartment_id, geo_area_id) VALUES (?, ?)`,
                args: [aptId, `beat:${feature.properties.SLUG}`],
              });
              aptBeatMapped++;
              break;
            }
          } catch {
            // Invalid geometry — skip
          }
        }
      }
    }
  }

  console.log(`  Apartments → city: ${aptCityMapped}`);
  console.log(`  Apartments → SF neighborhood: ${aptNeighborhoodMapped}`);
  console.log(`  Apartments → Oakland beat: ${aptBeatMapped}`);

  // 6. Populate population data
  console.log('\n--- Populating population data ---');
  let popUpdated = 0;

  // City populations
  for (const [city, pop] of Object.entries(CITY_POPULATIONS)) {
    const id = `city:${toSlug(city)}`;
    await db.execute({
      sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
      args: [pop, id],
    });
    popUpdated++;
  }
  console.log(`  Updated ${popUpdated} city populations`);

  // SF neighborhood populations
  let neighborhoodPopUpdated = 0;
  for (const feature of sfFeatures) {
    const name = feature.properties.NAME;
    const id = `neighborhood:${feature.properties.SLUG}`;
    const pop = SF_NEIGHBORHOOD_POPULATIONS[name] ?? 20000; // default for unlisted
    await db.execute({
      sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
      args: [pop, id],
    });
    neighborhoodPopUpdated++;
  }
  console.log(`  Updated ${neighborhoodPopUpdated} SF neighborhood populations`);

  // Oakland beat populations (average)
  let beatPopUpdated = 0;
  for (const feature of oakFeatures) {
    const id = `beat:${feature.properties.SLUG}`;
    await db.execute({
      sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
      args: [OAKLAND_BEAT_DEFAULT_POPULATION, id],
    });
    beatPopUpdated++;
  }
  console.log(`  Updated ${beatPopUpdated} Oakland beat populations`);

  // Summary
  const totalGeoAreas = await db.execute('SELECT COUNT(*) as cnt FROM geo_areas');
  const totalStationMappings = await db.execute('SELECT COUNT(*) as cnt FROM station_geo_areas');
  const totalAptMappings = await db.execute('SELECT COUNT(*) as cnt FROM apartment_geo_areas');
  console.log(`\n--- Summary ---`);
  console.log(`  geo_areas: ${totalGeoAreas.rows[0].cnt}`);
  console.log(`  station_geo_areas: ${totalStationMappings.rows[0].cnt}`);
  console.log(`  apartment_geo_areas: ${totalAptMappings.rows[0].cnt}`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
