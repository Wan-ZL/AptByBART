/**
 * Backfill geo_areas.population for any row where it is NULL or 0.
 *
 * Strategy per area_type:
 *  - tract: already populated from ACS by fetch-census-tracts.ts. Any remaining
 *    NULLs are filled via ACS 5-year API keyed on GEOID (id format tract:<GEOID>).
 *  - city: static populations from seed-geo-areas.ts (already applied). Any
 *    remaining NULLs are filled via ACS place-level API.
 *  - neighborhood: SF neighborhood populations from seed-geo-areas.ts. Fallback
 *    is the 20_000 default used there.
 *  - beat: Oakland beats matched by slug already populated. Any NULL beats are
 *    non-geojson beats (e.g. auto-created from crime rows with unusual IDs);
 *    fill with the Oakland beat average.
 *  - county: sum populations of constituent cities in DB; fall back to ACS.
 *
 * Idempotent — only touches rows whose population is NULL or 0.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/client';

const PROJECT_ROOT = join(__dirname, '..');

// Parse .env.local so TURSO_* vars work when present.
try {
  const envText = readFileSync(join(PROJECT_ROOT, '.env.local'), 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {
  // No .env.local — fine for local dev.
}

const OAKLAND_BEAT_DEFAULT_POPULATION = 12372;

// FIPS code mapping for Bay Area counties we care about.
const COUNTY_FIPS: Record<string, string> = {
  'county:alameda': '001',
  'county:contra_costa': '013',
  'county:marin': '041',
  'county:napa': '055',
  'county:san_francisco': '075',
  'county:san_mateo': '081',
  'county:santa_clara': '085',
  'county:solano': '095',
  'county:sonoma': '097',
};

interface GeoRow {
  id: string;
  area_type: string;
  name: string;
  population: number | null;
}

async function loadGeoAreas(): Promise<GeoRow[]> {
  const res = await db.execute(
    'SELECT id, area_type, name, population FROM geo_areas',
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    area_type: r.area_type as string,
    name: r.name as string,
    population: (r.population as number | null) ?? null,
  }));
}

async function coverageByType(): Promise<Record<string, { total: number; missing: number }>> {
  const res = await db.execute(
    `SELECT area_type,
            COUNT(*) AS total,
            SUM(CASE WHEN population IS NULL OR population = 0 THEN 1 ELSE 0 END) AS missing
     FROM geo_areas
     GROUP BY area_type
     ORDER BY area_type`,
  );
  const out: Record<string, { total: number; missing: number }> = {};
  for (const row of res.rows) {
    out[row.area_type as string] = {
      total: Number(row.total),
      missing: Number(row.missing),
    };
  }
  return out;
}

function printCoverage(
  label: string,
  coverage: Record<string, { total: number; missing: number }>,
) {
  console.log(`\n--- ${label} ---`);
  console.log('area_type      | total | missing | covered%');
  console.log('---------------|-------|---------|---------');
  for (const [t, { total, missing }] of Object.entries(coverage)) {
    const pct = total === 0 ? 0 : ((total - missing) / total) * 100;
    console.log(
      `${t.padEnd(14)} | ${String(total).padStart(5)} | ${String(missing).padStart(7)} | ${pct.toFixed(1).padStart(7)}%`,
    );
  }
}

/**
 * Fetch tract populations via ACS 5-year API for the listed GEOIDs.
 * Returns a Map of GEOID (11-char state+county+tract) -> population.
 */
async function fetchAcsTractPopulations(geoids: string[]): Promise<Map<string, number>> {
  if (geoids.length === 0) return new Map();

  // GEOID = SSCCCTTTTTT (11 digits): state(2) + county(3) + tract(6)
  const counties = new Set<string>();
  for (const g of geoids) {
    if (g.length >= 5) counties.add(g.slice(2, 5));
  }
  const countyList = [...counties].join(',');
  const url = `https://api.census.gov/data/2022/acs/acs5?get=B01003_001E&for=tract:*&in=state:06+county:${countyList}`;

  console.log(`  Fetching ACS tract populations (counties=${countyList})...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS ${res.status}: ${await res.text()}`);
  const rows: string[][] = await res.json();

  const popMap = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const [popStr, state, county, tract] = rows[i];
    const geoid = `${state}${county}${tract}`;
    const pop = parseInt(popStr, 10);
    if (!Number.isNaN(pop) && pop >= 0) popMap.set(geoid, pop);
  }
  return popMap;
}

/**
 * Normalize a city name for fuzzy matching against ACS place "NAME" field.
 * ACS NAME looks like "Vallejo city, California" or "Castro Valley CDP, California".
 * We strip the suffix and lowercase for comparison.
 */
function normalizeCityName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[,_-]+/g, ' ')
    .replace(/\s+(city|cdp|town|village)(\s+of)?/g, '')
    .replace(/\s+california$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch California place (city/CDP) populations via ACS 5-year API.
 * Returns a Map keyed by normalized place name → population.
 * Uses B01003_001E (total population, single-var endpoint). B01001_001E also works.
 */
async function fetchAcsPlacePopulations(): Promise<Map<string, number>> {
  const url =
    'https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E&for=place:*&in=state:06';
  console.log('  Fetching ACS CA place populations...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS ${res.status}: ${await res.text()}`);
  const rows: string[][] = await res.json();

  const out = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const [name, popStr] = rows[i];
    const pop = parseInt(popStr, 10);
    if (Number.isNaN(pop) || pop < 0) continue;
    const key = normalizeCityName(name);
    // Prefer "city" over "CDP" when duplicate normalized keys appear
    // (e.g. "Mountain View CDP" vs "Mountain View city").
    const existing = out.get(key);
    if (existing == null || /city,/i.test(name)) {
      out.set(key, pop);
    }
  }
  return out;
}

/**
 * Fetch Bay Area county populations via ACS.
 */
async function fetchAcsCountyPopulations(): Promise<Map<string, number>> {
  const countyList = Object.values(COUNTY_FIPS).join(',');
  const url = `https://api.census.gov/data/2022/acs/acs5?get=B01001_001E&for=county:${countyList}&in=state:06`;

  console.log('  Fetching ACS county populations...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS ${res.status}: ${await res.text()}`);
  const rows: string[][] = await res.json();

  const out = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const [popStr, , countyFips] = rows[i];
    const pop = parseInt(popStr, 10);
    if (!Number.isNaN(pop) && pop >= 0) out.set(countyFips, pop);
  }
  return out;
}

/**
 * For each NULL county, first sum constituent cities (if any live in the DB with
 * a parent_area_id link), else fall back to ACS.
 */
async function computeCountyPopulations(
  missing: GeoRow[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  // Try sum-of-children first (parent_area_id link).
  const childSum = await db.execute(
    `SELECT parent_area_id, SUM(population) AS pop
     FROM geo_areas
     WHERE area_type IN ('city', 'tract')
       AND parent_area_id IS NOT NULL
       AND population IS NOT NULL
     GROUP BY parent_area_id`,
  );
  const childPop = new Map<string, number>();
  for (const row of childSum.rows) {
    childPop.set(row.parent_area_id as string, Number(row.pop));
  }

  const needsAcs: GeoRow[] = [];
  for (const county of missing) {
    const summed = childPop.get(county.id);
    if (summed && summed > 0) {
      out.set(county.id, summed);
    } else {
      needsAcs.push(county);
    }
  }

  if (needsAcs.length > 0) {
    const acs = await fetchAcsCountyPopulations();
    for (const county of needsAcs) {
      const fips = COUNTY_FIPS[county.id];
      if (!fips) {
        console.warn(`    No FIPS mapping for ${county.id}; skipping`);
        continue;
      }
      const pop = acs.get(fips);
      if (pop && pop > 0) out.set(county.id, pop);
    }
  }

  return out;
}

async function main() {
  console.log('=== Backfill geo_areas.population ===');

  const before = await coverageByType();
  printCoverage('BEFORE', before);

  const allAreas = await loadGeoAreas();
  const missing = allAreas.filter(
    (a) => a.population == null || a.population === 0,
  );

  if (missing.length === 0) {
    console.log('\nNo rows need backfilling — everything has population already.');
    return;
  }

  console.log(`\nRows to backfill: ${missing.length}`);
  for (const row of missing) {
    console.log(`  ${row.area_type.padEnd(12)} ${row.id}  (${row.name})`);
  }

  // Group by type.
  const byType = new Map<string, GeoRow[]>();
  for (const row of missing) {
    const arr = byType.get(row.area_type) ?? [];
    arr.push(row);
    byType.set(row.area_type, arr);
  }

  let updated = 0;

  // Tracts — use ACS keyed on GEOID.
  const missingTracts = byType.get('tract') ?? [];
  if (missingTracts.length > 0) {
    console.log(`\n--- Tracts (${missingTracts.length} missing) ---`);
    const geoids = missingTracts
      .map((t) => t.id.replace(/^tract:/, ''))
      .filter((g) => /^\d{11}$/.test(g));
    const popMap = await fetchAcsTractPopulations(geoids);
    for (const tract of missingTracts) {
      const geoid = tract.id.replace(/^tract:/, '');
      const pop = popMap.get(geoid);
      if (pop != null && pop > 0) {
        await db.execute({
          sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
          args: [pop, tract.id],
        });
        updated++;
      } else {
        console.warn(`    No ACS data for ${tract.id}`);
      }
    }
  }

  // Cities — look up via ACS place (city + CDP) populations.
  const missingCities = byType.get('city') ?? [];
  if (missingCities.length > 0) {
    console.log(`\n--- Cities (${missingCities.length} missing) ---`);
    const placePop = await fetchAcsPlacePopulations();
    for (const city of missingCities) {
      const slug = city.id.replace(/^city:/, '');
      const candidates = new Set<string>([
        normalizeCityName(city.name),
        normalizeCityName(slug),
        normalizeCityName(slug.replace(/[-_]+/g, ' ')),
      ]);
      let pop: number | undefined;
      for (const key of candidates) {
        pop = placePop.get(key);
        if (pop != null) break;
      }
      if (pop != null && pop > 0) {
        await db.execute({
          sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
          args: [pop, city.id],
        });
        console.log(`    ${city.id} -> ${pop}`);
        updated++;
      } else {
        console.warn(`    No ACS place match for ${city.id} (${city.name})`);
      }
    }
  }

  // Neighborhoods — fall back to default if unknown.
  const missingNeighborhoods = byType.get('neighborhood') ?? [];
  if (missingNeighborhoods.length > 0) {
    console.log(`\n--- Neighborhoods (${missingNeighborhoods.length} missing) ---`);
    for (const n of missingNeighborhoods) {
      await db.execute({
        sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
        args: [20000, n.id],
      });
      console.log(`    ${n.id} -> 20000 (default)`);
      updated++;
    }
  }

  // Beats — Oakland average default.
  const missingBeats = byType.get('beat') ?? [];
  if (missingBeats.length > 0) {
    console.log(`\n--- Beats (${missingBeats.length} missing) ---`);
    for (const beat of missingBeats) {
      await db.execute({
        sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
        args: [OAKLAND_BEAT_DEFAULT_POPULATION, beat.id],
      });
      console.log(`    ${beat.id} -> ${OAKLAND_BEAT_DEFAULT_POPULATION} (Oakland beat average)`);
      updated++;
    }
  }

  // Counties — sum of children, fallback ACS.
  const missingCounties = byType.get('county') ?? [];
  if (missingCounties.length > 0) {
    console.log(`\n--- Counties (${missingCounties.length} missing) ---`);
    const popByCounty = await computeCountyPopulations(missingCounties);
    for (const county of missingCounties) {
      const pop = popByCounty.get(county.id);
      if (pop && pop > 0) {
        await db.execute({
          sql: 'UPDATE geo_areas SET population = ? WHERE id = ?',
          args: [pop, county.id],
        });
        console.log(`    ${county.id} -> ${pop}`);
        updated++;
      } else {
        console.warn(`    No source for ${county.id}`);
      }
    }
  }

  console.log(`\nUpdated ${updated} rows`);

  const after = await coverageByType();
  printCoverage('AFTER', after);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
