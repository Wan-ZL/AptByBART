import { readFileSync } from 'fs';
import { resolve } from 'path';
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

// ---------- Station groupings by data source ----------

const SF_STATIONS = ['EMBR', 'MONT', 'POWL', 'CIVC', '16TH', '24TH', 'GLEN', 'BALB', 'DALY'];

const OAKLAND_STATIONS = ['WOAK', '12TH', '19TH', 'LAKE', 'FTVL', 'COLS', 'MCAR', 'ROCK', 'ASHB', 'DBRK', 'NBRK'];

// Station → city mapping for CA DOJ data
const DOJ_STATION_CITY: Record<string, string> = {
  COLM: 'Daly City',   // Colma is unincorporated, policed by Daly City — map to closest match
  SSAN: 'South San Francisco',
  SBRN: 'San Bruno',
  MLBR: 'Millbrae',
  SFIA: 'San Bruno',   // SFO airport is in unincorporated area, San Bruno is nearest city in DOJ data
  PLZA: 'El Cerrito',
  DELN: 'Richmond',
  RICH: 'Richmond',
  ORIN: 'Orinda',
  LAFY: 'Lafayette',
  WCRK: 'Walnut Creek',
  PHIL: 'Pleasant Hill',
  CONC: 'Concord',
  NCON: 'Concord',
  PITT: 'Pittsburg',
  PCTR: 'Pittsburg',
  ANTC: 'Antioch',
  BAYF: 'San Leandro',
  SANL: 'San Leandro',
  HAYW: 'Hayward',
  SHAY: 'Hayward',
  UCTY: 'Union City',
  FRMT: 'Fremont',
  WARM: 'Fremont',
  CAST: 'Castro Valley',  // unincorporated, use as-is — DOJ may have Alameda County
  DUBL: 'Dublin',
  WDUB: 'Dublin',
  MLPT: 'Milpitas',
  BERY: 'San Jose',
  OAKL: 'Oakland',        // Oakland Airport
};

interface CrimeCounts {
  violent: number;
  property: number;
  vehicle: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ---------- Source 1: DataSF (San Francisco) ----------

async function fetchSFCrime(stationId: string, lat: number, lng: number): Promise<CrimeCounts> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const dateStr = twelveMonthsAgo.toISOString().split('T')[0];

  const baseUrl = 'https://data.sfgov.org/resource/wg3w-h783.json';
  const where = `incident_date > '${dateStr}' AND within_circle(point, ${lat}, ${lng}, 800)`;
  const params = new URLSearchParams({
    $where: where,
    $select: 'incident_category, count(*) as cnt',
    $group: 'incident_category',
    $limit: '50000',
  });

  const violentCategories = new Set(['Assault', 'Robbery', 'Homicide', 'Rape']);
  const propertyCategories = new Set(['Burglary', 'Larceny Theft', 'Arson', 'Vandalism']);
  const vehicleCategories = new Set(['Motor Vehicle Theft']);

  let violent = 0, property = 0, vehicle = 0;

  try {
    const res = await fetch(`${baseUrl}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: Array<{ incident_category: string; cnt: string }> = await res.json();

    for (const row of data) {
      const cat = row.incident_category;
      const count = parseInt(row.cnt, 10);
      if (violentCategories.has(cat)) violent += count;
      else if (propertyCategories.has(cat)) property += count;
      else if (vehicleCategories.has(cat)) vehicle += count;
    }

    // Separate query for "Larceny - From Vehicle" subcategory (counted as vehicle crime)
    const subParams = new URLSearchParams({
      $where: `incident_date > '${dateStr}' AND within_circle(point, ${lat}, ${lng}, 800) AND incident_subcategory = 'Larceny - From Vehicle'`,
      $select: 'count(*) as cnt',
      $limit: '1',
    });
    const subRes = await fetch(`${baseUrl}?${subParams}`);
    if (subRes.ok) {
      const subData: Array<{ cnt: string }> = await subRes.json();
      if (subData.length > 0) {
        vehicle += parseInt(subData[0].cnt, 10);
      }
    }
  } catch (e) {
    console.warn(`  Warning: SF data fetch failed for ${stationId}:`, (e as Error).message);
  }

  return { violent, property, vehicle };
}

// ---------- Source 2: Oakland Open Data ----------

async function fetchOaklandCrime(stationId: string, lat: number, lng: number): Promise<CrimeCounts> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const dateStr = twelveMonthsAgo.toISOString().split('T')[0];

  const baseUrl = 'https://data.oaklandca.gov/resource/ym6k-rx7a.json';
  const where = `datetime > '${dateStr}' AND within_circle(location_1, ${lat}, ${lng}, 800)`;
  const params = new URLSearchParams({
    $where: where,
    $select: 'crimetype, count(*) as cnt',
    $group: 'crimetype',
    $limit: '50000',
  });

  const violentTypes = new Set(['ASSAULT', 'ROBBERY']);
  const propertyTypes = new Set(['BURGLARY', 'THEFT']);
  const vehicleTypes = new Set(['BURG - AUTO', 'VEHICLE THEFT']);

  let violent = 0, property = 0, vehicle = 0;

  try {
    const res = await fetch(`${baseUrl}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: Array<{ crimetype: string; cnt: string }> = await res.json();

    for (const row of data) {
      const type = row.crimetype;
      const count = parseInt(row.cnt, 10);
      if (violentTypes.has(type)) violent += count;
      else if (propertyTypes.has(type)) property += count;
      else if (vehicleTypes.has(type)) vehicle += count;
    }
  } catch (e) {
    console.warn(`  Warning: Oakland data fetch failed for ${stationId}:`, (e as Error).message);
  }

  return { violent, property, vehicle };
}

// ---------- Source 3: CA DOJ OpenJustice CSV ----------

interface DojCityData {
  violent: number;
  property: number;
  vehicle: number;
}

async function fetchDojData(): Promise<Map<string, DojCityData>> {
  const csvUrl = 'https://data-openjustice.doj.ca.gov/sites/default/files/dataset/2024-07/Crimes_and_Clearances_with_Arson-1985-2023.csv';
  const cityMap = new Map<string, DojCityData>();

  // Cities we care about (lowercase for case-insensitive matching)
  const targetCities = new Set([
    'daly city', 'colma', 'south san francisco', 'san bruno', 'millbrae',
    'richmond', 'el cerrito', 'orinda', 'lafayette', 'walnut creek',
    'pleasant hill', 'concord', 'pittsburg', 'antioch',
    'fremont', 'union city', 'hayward', 'castro valley', 'dublin',
    'pleasanton', 'san leandro', 'milpitas', 'san jose', 'oakland',
  ]);

  try {
    console.log('  Downloading CA DOJ CSV...');
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csvText = await res.text();
    console.log(`  Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)}MB CSV`);

    const lines = csvText.split('\n');
    if (lines.length < 2) throw new Error('CSV has no data rows');

    // Parse header
    const header = parseCSVLine(lines[0]);
    const yearIdx = header.indexOf('Year');
    const countyIdx = header.indexOf('County');
    // The CSV uses "NCICCode" for city/agency name
    const ncicIdx = header.findIndex(h => h === 'NCICCode' || h === 'NCIC_Code');
    const violentIdx = header.indexOf('Violent_sum');
    const propertyIdx = header.indexOf('Property_sum');
    const vehicleIdx = header.indexOf('VehicleTheft_sum');

    if (yearIdx === -1 || violentIdx === -1 || propertyIdx === -1) {
      throw new Error(`Missing expected columns. Headers: ${header.slice(0, 15).join(', ')}`);
    }

    // Find the most recent year
    let maxYear = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseCSVLine(lines[i]);
      const year = parseInt(cols[yearIdx], 10);
      if (year > maxYear) maxYear = year;
    }
    console.log(`  Most recent year in DOJ data: ${maxYear}`);

    // Collect data for the most recent year
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseCSVLine(lines[i]);
      const year = parseInt(cols[yearIdx], 10);
      if (year !== maxYear) continue;

      // Try NCICCode column first, then County
      const cityRaw = ncicIdx !== -1 ? cols[ncicIdx] : cols[countyIdx];
      if (!cityRaw) continue;
      const cityLower = cityRaw.trim().toLowerCase();

      if (!targetCities.has(cityLower)) continue;

      const violent = parseInt(cols[violentIdx], 10) || 0;
      const property = parseInt(cols[propertyIdx], 10) || 0;
      const vehicle = vehicleIdx !== -1 ? (parseInt(cols[vehicleIdx], 10) || 0) : 0;

      // Use the original casing from our target set for the key
      const cityKey = cityRaw.trim().toLowerCase();
      const existing = cityMap.get(cityKey);
      if (existing) {
        existing.violent += violent;
        existing.property += property;
        existing.vehicle += vehicle;
      } else {
        cityMap.set(cityKey, { violent, property, vehicle });
      }
    }
  } catch (e) {
    console.warn('  Warning: DOJ CSV fetch/parse failed:', (e as Error).message);
  }

  return cityMap;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ---------- Main ingestion ----------

async function main() {
  console.log('=== Crime Data Ingestion ===\n');

  // Fetch all station coordinates from the database
  const stationRows = await db.execute('SELECT id, lat, lng, city FROM bart_stations');
  const stationMap = new Map<string, { lat: number; lng: number; city: string }>();
  for (const row of stationRows.rows) {
    stationMap.set(row.id as string, {
      lat: row.lat as number,
      lng: row.lng as number,
      city: (row.city as string) || '',
    });
  }
  console.log(`Loaded ${stationMap.size} stations from database.\n`);

  const now = new Date();
  const dataYear = now.getFullYear();
  const dataMonth = now.getMonth() + 1;

  const allCounts = new Map<string, CrimeCounts>();

  // --- SF stations ---
  console.log('--- Fetching San Francisco crime data ---');
  for (const stationId of SF_STATIONS) {
    const station = stationMap.get(stationId);
    if (!station) {
      console.warn(`  Station ${stationId} not found in database, skipping`);
      continue;
    }
    console.log(`  ${stationId}...`);
    const counts = await fetchSFCrime(stationId, station.lat, station.lng);
    allCounts.set(stationId, counts);
    console.log(`    violent=${counts.violent} property=${counts.property} vehicle=${counts.vehicle}`);
    await sleep(300);
  }

  // --- Oakland stations ---
  console.log('\n--- Fetching Oakland crime data ---');
  for (const stationId of OAKLAND_STATIONS) {
    const station = stationMap.get(stationId);
    if (!station) {
      console.warn(`  Station ${stationId} not found in database, skipping`);
      continue;
    }
    console.log(`  ${stationId}...`);
    const counts = await fetchOaklandCrime(stationId, station.lat, station.lng);
    allCounts.set(stationId, counts);
    console.log(`    violent=${counts.violent} property=${counts.property} vehicle=${counts.vehicle}`);
    await sleep(300);
  }

  // --- DOJ stations (all remaining) ---
  console.log('\n--- Fetching CA DOJ data ---');
  const dojData = await fetchDojData();
  console.log(`  Found data for ${dojData.size} cities`);

  const dojStations = Object.keys(DOJ_STATION_CITY);
  for (const stationId of dojStations) {
    const cityName = DOJ_STATION_CITY[stationId];
    const cityData = dojData.get(cityName.toLowerCase());
    if (cityData) {
      allCounts.set(stationId, {
        violent: cityData.violent,
        property: cityData.property,
        vehicle: cityData.vehicle,
      });
      console.log(`  ${stationId} (${cityName}): violent=${cityData.violent} property=${cityData.property} vehicle=${cityData.vehicle}`);
    } else {
      console.warn(`  ${stationId}: No DOJ data found for "${cityName}"`);
      allCounts.set(stationId, { violent: 0, property: 0, vehicle: 0 });
    }
  }

  // --- Calculate safety scores ---
  console.log('\n--- Calculating safety scores ---');

  // Find max weighted score across all stations
  let maxWeighted = 0;
  for (const [, counts] of allCounts) {
    const weighted = counts.violent * 3 + counts.property * 1 + counts.vehicle * 1.5;
    if (weighted > maxWeighted) maxWeighted = weighted;
  }

  if (maxWeighted === 0) maxWeighted = 1; // avoid division by zero

  // --- Insert into database ---
  console.log('\n--- Inserting into database ---');

  const stmts: Array<{ sql: string; args: any[] }> = [];

  for (const [stationId, counts] of allCounts) {
    const weighted = counts.violent * 3 + counts.property * 1 + counts.vehicle * 1.5;
    const safetyScore = Math.max(1, Math.min(10, 10 - (weighted / maxWeighted) * 10));
    const total = counts.violent + counts.property + counts.vehicle;

    // Determine source
    let source = 'ca_doj';
    if (SF_STATIONS.includes(stationId)) source = 'datasf';
    else if (OAKLAND_STATIONS.includes(stationId)) source = 'oakland_opendata';

    stmts.push({
      sql: `INSERT OR REPLACE INTO crime_stats
            (station_id, data_year, data_month, violent_crime_count, property_crime_count, vehicle_crime_count, total_incidents, safety_score, source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [stationId, dataYear, dataMonth, counts.violent, counts.property, counts.vehicle, total, Math.round(safetyScore * 10) / 10, source],
    });
  }

  await db.batch(stmts, 'write');
  console.log(`Inserted/updated ${stmts.length} crime_stats records.`);

  // --- Recalculate all safety scores across all stations in DB ---
  console.log('\n--- Recalculating all safety scores (global normalization) ---');

  const allStats = await db.execute('SELECT id, station_id, violent_crime_count, property_crime_count, vehicle_crime_count FROM crime_stats');
  let globalMax = 0;
  for (const row of allStats.rows) {
    const v = (row.violent_crime_count as number) || 0;
    const p = (row.property_crime_count as number) || 0;
    const ve = (row.vehicle_crime_count as number) || 0;
    const w = v * 3 + p * 1 + ve * 1.5;
    if (w > globalMax) globalMax = w;
  }
  if (globalMax === 0) globalMax = 1;

  const updateStmts: Array<{ sql: string; args: any[] }> = [];
  for (const row of allStats.rows) {
    const v = (row.violent_crime_count as number) || 0;
    const p = (row.property_crime_count as number) || 0;
    const ve = (row.vehicle_crime_count as number) || 0;
    const w = v * 3 + p * 1 + ve * 1.5;
    const score = Math.max(1, Math.min(10, 10 - (w / globalMax) * 10));
    updateStmts.push({
      sql: 'UPDATE crime_stats SET safety_score = ? WHERE id = ?',
      args: [Math.round(score * 10) / 10, row.id],
    });
  }
  await db.batch(updateStmts, 'write');
  console.log(`Recalculated safety scores for ${updateStmts.length} records.`);

  // --- Summary ---
  console.log('\n=== Safety Score Summary ===');
  const summary = await db.execute(
    `SELECT cs.station_id, bs.name, cs.safety_score, cs.violent_crime_count, cs.property_crime_count, cs.vehicle_crime_count, cs.source
     FROM crime_stats cs
     JOIN bart_stations bs ON cs.station_id = bs.id
     ORDER BY cs.safety_score DESC`
  );

  console.log('Station'.padEnd(30) + 'Score'.padStart(6) + 'Violent'.padStart(8) + 'Property'.padStart(9) + 'Vehicle'.padStart(8) + '  Source');
  for (const row of summary.rows) {
    const name = (row.name as string).padEnd(30);
    const score = String(row.safety_score).padStart(6);
    const v = String(row.violent_crime_count).padStart(8);
    const p = String(row.property_crime_count).padStart(9);
    const ve = String(row.vehicle_crime_count).padStart(8);
    const src = `  ${row.source}`;
    console.log(name + score + v + p + ve + src);
  }

  console.log('\nDone!');
}

main().catch(console.error);
