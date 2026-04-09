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

const BART_API_KEY = 'MW9S-E7SL-26DU-VV8V';
const DEST_STATION = 'MONT';

const BART_LINES: Record<string, string[]> = {
  yellow: ['ANTC','PCTR','PITT','NCON','CONC','PHIL','WCRK','LAFY','ORIN','ROCK','MCAR','19TH','12TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY','COLM','SSAN','SBRN','MLBR','SFIA'],
  orange: ['RICH','DELN','PLZA','NBRK','DBRK','ASHB','MCAR','19TH','12TH','LAKE','FTVL','COLS','SANL','BAYF','HAYW','SHAY','UCTY','FRMT','WARM','MLPT','BERY'],
  red: ['RICH','DELN','PLZA','NBRK','DBRK','ASHB','MCAR','19TH','12TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY','COLM','SSAN','SBRN','MLBR'],
  blue: ['DUBL','WDUB','CAST','BAYF','SANL','COLS','FTVL','LAKE','12TH','19TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY'],
  green: ['BERY','MLPT','WARM','FRMT','UCTY','SHAY','HAYW','BAYF','SANL','COLS','FTVL','LAKE','12TH','19TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY'],
  beige: ['OAKL','COLS'],
};

function getLineColors(abbr: string): string[] {
  const colors: string[] = [];
  for (const [color, stations] of Object.entries(BART_LINES)) {
    if (stations.includes(abbr)) colors.push(color);
  }
  return colors;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface BartStation {
  name: string;
  abbr: string;
  gtfs_latitude: string;
  gtfs_longitude: string;
  address: string;
  city: string;
  county: string;
}

interface StationRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  county: string;
  line_colors: string;
  travel_time: number | null;
  fare_cents: number | null;
  monthly_commute_cost: number | null;
}

async function fetchStations(): Promise<BartStation[]> {
  const url = `https://api.bart.gov/api/stn.aspx?cmd=stns&key=${BART_API_KEY}&json=y`;
  const res = await fetch(url);
  const data = await res.json();
  return data.root.stations.station;
}

async function fetchFare(orig: string): Promise<number | null> {
  if (orig === DEST_STATION) return 0;
  try {
    const url = `https://api.bart.gov/api/sched.aspx?cmd=fare&orig=${orig}&dest=${DEST_STATION}&key=${BART_API_KEY}&json=y`;
    const res = await fetch(url);
    const data = await res.json();
    const fareStr = data.root.fares.fare?.[0]?.amount ?? data.root.fares?.fare?.amount;
    if (!fareStr) return null;
    return Math.round(parseFloat(fareStr) * 100);
  } catch (e) {
    console.warn(`  Warning: failed to fetch fare for ${orig}:`, (e as Error).message);
    return null;
  }
}

async function fetchTravelTime(orig: string): Promise<number | null> {
  if (orig === DEST_STATION) return 0;
  try {
    const url = `https://api.bart.gov/api/sched.aspx?cmd=depart&orig=${orig}&dest=${DEST_STATION}&date=now&key=${BART_API_KEY}&json=y&b=0&a=1`;
    const res = await fetch(url);
    const data = await res.json();
    const trips = data.root.schedule.request.trip;
    const tripTime = trips?.[0]?.['@tripTime'];
    if (!tripTime) return null;
    return parseInt(tripTime, 10);
  } catch (e) {
    console.warn(`  Warning: failed to fetch travel time for ${orig}:`, (e as Error).message);
    return null;
  }
}

async function main() {
  console.log('Fetching station list...');
  const stations = await fetchStations();
  console.log(`Found ${stations.length} stations.`);

  console.log(`Fetching fares and travel times for ${stations.length} stations...`);

  const rows: StationRow[] = [];

  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const abbr = s.abbr;
    console.log(`  [${i + 1}/${stations.length}] ${s.name} (${abbr})`);

    const [fareCents, travelTime] = await Promise.all([
      fetchFare(abbr),
      fetchTravelTime(abbr),
    ]);

    let monthlyCommuteCost: number | null = null;
    if (fareCents !== null) {
      monthlyCommuteCost = Math.round(fareCents * 0.9375 * 2 * 22);
    }

    rows.push({
      id: abbr,
      name: s.name,
      lat: parseFloat(s.gtfs_latitude),
      lng: parseFloat(s.gtfs_longitude),
      address: s.address,
      city: s.city,
      county: s.county,
      line_colors: JSON.stringify(getLineColors(abbr)),
      travel_time: travelTime,
      fare_cents: fareCents,
      monthly_commute_cost: monthlyCommuteCost,
    });

    // Be respectful to BART's API
    if (i < stations.length - 1) await sleep(200);
  }

  // Insert into database using a batch transaction
  console.log('\nInserting into database...');

  const stmts = [
    { sql: 'DELETE FROM bart_stations', args: [] },
    ...rows.map(r => ({
      sql: `INSERT INTO bart_stations (id, name, lat, lng, address, city, county, line_colors, travel_time_to_montgomery, fare_to_montgomery, monthly_commute_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id, r.name, r.lat, r.lng, r.address, r.city, r.county,
        r.line_colors, r.travel_time, r.fare_cents, r.monthly_commute_cost,
      ] as any[],
    })),
  ];

  await db.batch(stmts, 'write');

  console.log(`\nSeeded ${rows.length} stations successfully!\n`);

  // Summary: cheapest and closest stations
  const withFare = rows.filter(r => r.fare_cents !== null && r.fare_cents > 0);
  const withTime = rows.filter(r => r.travel_time !== null && r.travel_time > 0);

  withFare.sort((a, b) => a.fare_cents! - b.fare_cents!);
  withTime.sort((a, b) => a.travel_time! - b.travel_time!);

  console.log('=== Top 10 Cheapest Stations (fare to Montgomery) ===');
  console.log('Station'.padEnd(30) + 'Fare'.padStart(8) + 'Monthly'.padStart(10));
  for (const r of withFare.slice(0, 10)) {
    const fare = `$${(r.fare_cents! / 100).toFixed(2)}`;
    const monthly = `$${(r.monthly_commute_cost! / 100).toFixed(2)}`;
    console.log(r.name.padEnd(30) + fare.padStart(8) + monthly.padStart(10));
  }

  console.log('\n=== Top 10 Closest Stations (travel time to Montgomery) ===');
  console.log('Station'.padEnd(30) + 'Minutes'.padStart(8));
  for (const r of withTime.slice(0, 10)) {
    console.log(r.name.padEnd(30) + `${r.travel_time}`.padStart(8));
  }
}

main().catch(console.error);
