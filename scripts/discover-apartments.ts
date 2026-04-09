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

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!GOOGLE_PLACES_API_KEY) {
  console.error('GOOGLE_PLACES_API_KEY is required. Set it in .env.local or environment.');
  process.exit(1);
}

interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface PlaceResult {
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
}

interface DiscoveredApartment {
  name: string;
  address: string;
  lat: number;
  lng: number;
  website_url: string;
  nearest_station_id: string;
  walk_min_to_bart: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestStation(
  lat: number,
  lng: number,
  stations: Station[]
): { stationId: string; walkMin: number } {
  let minDist = Infinity;
  let nearestId = stations[0].id;
  for (const s of stations) {
    const dist = haversineMeters(lat, lng, s.lat, s.lng);
    if (dist < minDist) {
      minDist = dist;
      nearestId = s.id;
    }
  }
  // Walking speed: ~80 meters per minute
  const walkMin = Math.round(minDist / 80);
  return { stationId: nearestId, walkMin };
}

async function searchNearby(lat: number, lng: number): Promise<PlaceResult[]> {
  const url = 'https://places.googleapis.com/v1/places:searchNearby';
  const body = {
    includedTypes: [
      'apartment_building',
      'apartment_complex',
      'condominium_complex',
      'housing_complex',
    ],
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 1600,
      },
    },
    maxResultCount: 20,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY!,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.location,places.websiteUri,places.rating,places.userRatingCount,places.types',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.places ?? [];
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/[.,#\-]/g, '').replace(/\s+/g, ' ').trim();
}

async function main() {
  // 1. Read all BART stations from database
  console.log('Loading BART stations from database...');
  const result = await db.execute('SELECT id, name, lat, lng FROM bart_stations');
  const stations: Station[] = result.rows.map((r: any) => ({
    id: r.id as string,
    name: r.name as string,
    lat: r.lat as number,
    lng: r.lng as number,
  }));
  console.log(`Found ${stations.length} stations.\n`);

  if (stations.length === 0) {
    console.error('No stations found. Run seed:stations first.');
    process.exit(1);
  }

  // 2. Search for apartments near each station
  const allPlaces: DiscoveredApartment[] = [];
  const seenAddresses = new Set<string>();
  const seenWebsites = new Set<string>();

  for (let i = 0; i < stations.length; i++) {
    const station = stations[i];
    console.log(`[${i + 1}/${stations.length}] Searching near ${station.name} (${station.id})...`);

    try {
      const places = await searchNearby(station.lat, station.lng);
      let added = 0;

      for (const place of places) {
        const name = place.displayName?.text;
        const address = place.formattedAddress;
        const lat = place.location?.latitude;
        const lng = place.location?.longitude;
        const website = place.websiteUri ?? '';

        if (!name || !address || lat == null || lng == null) continue;

        // Deduplicate by normalized address
        const normAddr = normalizeAddress(address);
        if (seenAddresses.has(normAddr)) continue;

        // Deduplicate by website URL (if present)
        if (website && seenWebsites.has(website)) continue;

        seenAddresses.add(normAddr);
        if (website) seenWebsites.add(website);

        const { stationId, walkMin } = findNearestStation(lat, lng, stations);

        allPlaces.push({
          name,
          address,
          lat,
          lng,
          website_url: website,
          nearest_station_id: stationId,
          walk_min_to_bart: walkMin,
        });
        added++;
      }

      console.log(`  Found ${places.length} results, ${added} new unique apartments`);
    } catch (err) {
      console.error(`  Error searching near ${station.name}:`, (err as Error).message);
    }

    // Rate limit: 500ms between API calls
    if (i < stations.length - 1) await sleep(500);
  }

  console.log(`\nDiscovered ${allPlaces.length} unique apartments total.\n`);

  if (allPlaces.length === 0) {
    console.log('No apartments found. Done.');
    return;
  }

  // 3. Check which apartments already exist in the database
  const existingResult = await db.execute('SELECT address FROM apartments');
  const existingAddresses = new Set(
    existingResult.rows.map((r: any) => normalizeAddress(r.address as string))
  );

  const newApartments = allPlaces.filter(
    a => !existingAddresses.has(normalizeAddress(a.address))
  );

  console.log(`${newApartments.length} new apartments to insert (${allPlaces.length - newApartments.length} already exist).\n`);

  if (newApartments.length === 0) {
    console.log('Nothing new to insert. Done.');
    return;
  }

  // 4. Insert new apartments in batches
  const BATCH_SIZE = 50;
  let inserted = 0;

  for (let i = 0; i < newApartments.length; i += BATCH_SIZE) {
    const batch = newApartments.slice(i, i + BATCH_SIZE);
    const stmts = batch.map(a => ({
      sql: `INSERT INTO apartments (name, address, lat, lng, website_url, nearest_station_id, walk_min_to_bart)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        a.name, a.address, a.lat, a.lng,
        a.website_url, a.nearest_station_id, a.walk_min_to_bart,
      ] as any[],
    }));

    await db.batch(stmts, 'write');
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${newApartments.length}`);
  }

  // 5. Summary
  console.log(`\nDone! Inserted ${inserted} new apartments.\n`);

  console.log('=== Top 20 Closest to BART ===');
  console.log('Name'.padEnd(40) + 'Station'.padStart(8) + 'Walk'.padStart(8));
  const sorted = [...newApartments].sort((a, b) => a.walk_min_to_bart - b.walk_min_to_bart);
  for (const a of sorted.slice(0, 20)) {
    const name = a.name.length > 38 ? a.name.slice(0, 35) + '...' : a.name;
    console.log(name.padEnd(40) + a.nearest_station_id.padStart(8) + `${a.walk_min_to_bart}m`.padStart(8));
  }
}

main().catch(console.error);
