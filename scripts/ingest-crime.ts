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

// ---------- Station → City mapping (all stations, single source: CA DOJ) ----------
// Using CA DOJ as the sole data source ensures all stations are compared
// under the same statistical standard (UCR), same time period, same methodology.
// Tradeoff: city-level granularity (all stations in the same city share one score).

const STATION_CITY: Record<string, string> = {
  // San Francisco
  EMBR: 'San Francisco', MONT: 'San Francisco', POWL: 'San Francisco',
  CIVC: 'San Francisco', '16TH': 'San Francisco', '24TH': 'San Francisco',
  GLEN: 'San Francisco', BALB: 'San Francisco',
  // Daly City / Colma
  DALY: 'Daly City', COLM: 'Daly City',
  // Peninsula
  SSAN: 'South San Francisco', SBRN: 'San Bruno', MLBR: 'Millbrae',
  SFIA: 'San Bruno',
  // East Bay - Oakland
  WOAK: 'Oakland', '12TH': 'Oakland', '19TH': 'Oakland',
  LAKE: 'Oakland', FTVL: 'Oakland', COLS: 'Oakland',
  MCAR: 'Oakland', OAKL: 'Oakland',
  // East Bay - Berkeley / North
  ROCK: 'Oakland', ASHB: 'Berkeley', DBRK: 'Berkeley', NBRK: 'Berkeley',
  PLZA: 'El Cerrito', DELN: 'Richmond', RICH: 'Richmond',
  // East Bay - Contra Costa
  ORIN: 'Orinda', LAFY: 'Lafayette', WCRK: 'Walnut Creek',
  PHIL: 'Pleasant Hill', CONC: 'Concord', NCON: 'Concord',
  PITT: 'Pittsburg', PCTR: 'Pittsburg', ANTC: 'Antioch',
  // East Bay - Alameda South
  BAYF: 'San Leandro', SANL: 'San Leandro',
  HAYW: 'Hayward', SHAY: 'Hayward',
  UCTY: 'Union City', FRMT: 'Fremont', WARM: 'Fremont',
  CAST: 'Hayward', // Castro Valley is unincorporated Alameda County, Hayward closest
  DUBL: 'Dublin', WDUB: 'Dublin',
  // South Bay
  MLPT: 'Milpitas', BERY: 'San Jose',
};

interface CrimeCounts {
  violent: number;
  property: number;
  vehicle: number;
}

// ---------- Single Source: CA DOJ OpenJustice CSV ----------

interface DojCityData {
  violent: number;
  property: number;
  vehicle: number;
}

async function fetchDojData(): Promise<Map<string, DojCityData>> {
  const csvUrl = 'https://data-openjustice.doj.ca.gov/sites/default/files/dataset/2024-07/Crimes_and_Clearances_with_Arson-1985-2023.csv';
  const cityMap = new Map<string, DojCityData>();

  // All cities we need (derived from STATION_CITY mapping)
  const targetCities = new Set(
    Object.values(STATION_CITY).map(c => c.toLowerCase())
  );

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

  // --- Single source: CA DOJ for all stations ---
  console.log('--- Fetching CA DOJ data (single source for all stations) ---');
  const dojData = await fetchDojData();
  console.log(`  Found data for ${dojData.size} cities\n`);

  for (const [stationId, cityName] of Object.entries(STATION_CITY)) {
    if (!stationMap.has(stationId)) {
      console.warn(`  Station ${stationId} not found in database, skipping`);
      continue;
    }
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

    const source = 'ca_doj';

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
