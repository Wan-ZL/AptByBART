/**
 * CA DOJ OpenJustice CSV ingester
 * Source: Crimes & Clearances with Arson (1985-2023)
 * Granularity: city + county + state
 * geo_area_id formats:
 *   - city:<slug>   (e.g., city:san_francisco) — BART target cities only
 *   - county:<slug> (e.g., county:alameda)     — all 9 Bay Area counties
 *   - state:california                         — statewide rollup
 *
 * County + state rows power the allocator's fallback tiers so tracts whose
 * parent city has no measurement can still inherit a number.
 */

import type { CrimeIngester, CrimeObservation, CrimeCategory } from '../../lib/crime-taxonomy';

// Station → City mapping (all BART stations)
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
  CAST: 'Hayward', DUBL: 'Dublin', WDUB: 'Dublin',
  // South Bay
  MLPT: 'Milpitas', BERY: 'San Jose',
};

// Unique target cities (lowercased)
const TARGET_CITIES = new Set(
  Object.values(STATION_CITY).map(c => c.toLowerCase())
);

// 9-county Bay Area. County names in the CSV appear as "<Name> County" (e.g. "Alameda County").
const BAY_AREA_COUNTIES = new Set([
  'alameda',
  'contra costa',
  'marin',
  'napa',
  'san francisco',
  'san mateo',
  'santa clara',
  'solano',
  'sonoma',
]);

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
}

function normalizeCountyName(raw: string): string | null {
  // CSV format: "Alameda County", "Contra Costa County", "San Francisco County".
  // Also seen: plain "Alameda" historically. Strip "County" suffix.
  const cleaned = raw.trim().replace(/\s+county\s*$/i, '').toLowerCase();
  return cleaned || null;
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

const CSV_URL = 'https://data-openjustice.doj.ca.gov/sites/default/files/dataset/2024-07/Crimes_and_Clearances_with_Arson-1985-2023.csv';

const COLUMN_CATEGORY_MAP: Record<string, CrimeCategory> = {
  'Violent_sum': 'violent',
  'Property_sum': 'property',
  'VehicleTheft_sum': 'vehicle',
};

export const caDojIngester: CrimeIngester = {
  sourceId: 'ca_doj',
  sourceName: 'CA DOJ OpenJustice (Crimes & Clearances)',
  apiType: 'csv_download',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Downloading CA DOJ CSV...');
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`CA DOJ CSV download failed: HTTP ${res.status}`);
    const csvText = await res.text();
    console.log(`  Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)}MB CSV`);

    const lines = csvText.split('\n');
    if (lines.length < 2) throw new Error('CSV has no data rows');

    // Parse header to find column indices
    const header = parseCSVLine(lines[0]);
    const yearIdx = header.indexOf('Year');
    const countyIdx = header.indexOf('County');
    const ncicIdx = header.findIndex(h => h === 'NCICCode' || h === 'NCIC_Code');
    const violentIdx = header.indexOf('Violent_sum');
    const propertyIdx = header.indexOf('Property_sum');
    const vehicleIdx = header.indexOf('VehicleTheft_sum');

    if (yearIdx === -1 || violentIdx === -1 || propertyIdx === -1) {
      throw new Error(`Missing expected columns. Found: ${header.slice(0, 15).join(', ')}`);
    }

    const cityColIdx = ncicIdx !== -1 ? ncicIdx : countyIdx;
    if (cityColIdx === -1 || countyIdx === -1) {
      throw new Error('Cannot find required columns (NCICCode/County)');
    }

    // Find most recent year
    let maxYear = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseCSVLine(lines[i]);
      const year = parseInt(cols[yearIdx], 10);
      if (year > maxYear) maxYear = year;
    }
    console.log(`  Most recent year in DOJ data: ${maxYear}`);

    // Aggregate by city (target BART cities only), by county (all 9 Bay Area counties),
    // and statewide — all for the most recent year.
    type Counts = { violent: number; property: number; vehicle: number };
    const newCounts = (): Counts => ({ violent: 0, property: 0, vehicle: 0 });
    const addCounts = (t: Counts, v: number, p: number, m: number) => {
      t.violent += v;
      t.property += p;
      t.vehicle += m;
    };

    const cityData = new Map<string, Counts>();
    const countyData = new Map<string, Counts>();
    const stateCounts = newCounts();

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseCSVLine(lines[i]);
      const year = parseInt(cols[yearIdx], 10);
      if (year !== maxYear) continue;

      const violent = parseInt(cols[violentIdx], 10) || 0;
      const property = parseInt(cols[propertyIdx], 10) || 0;
      const vehicle = vehicleIdx !== -1 ? (parseInt(cols[vehicleIdx], 10) || 0) : 0;

      // State: every row contributes.
      addCounts(stateCounts, violent, property, vehicle);

      // County: roll up into the 9 Bay Area counties.
      const countyRaw = cols[countyIdx];
      const countyNorm = countyRaw ? normalizeCountyName(countyRaw) : null;
      if (countyNorm && BAY_AREA_COUNTIES.has(countyNorm)) {
        let c = countyData.get(countyNorm);
        if (!c) {
          c = newCounts();
          countyData.set(countyNorm, c);
        }
        addCounts(c, violent, property, vehicle);
      }

      // City: only BART target cities (by NCIC agency name).
      const cityRaw = cols[cityColIdx];
      if (!cityRaw) continue;
      const cityLower = cityRaw.trim().toLowerCase();
      if (!TARGET_CITIES.has(cityLower)) continue;

      let existing = cityData.get(cityLower);
      if (!existing) {
        existing = newCounts();
        cityData.set(cityLower, existing);
      }
      addCounts(existing, violent, property, vehicle);
    }

    console.log(
      `  Found data for ${cityData.size} target cities, ${countyData.size} Bay Area counties, statewide rollup`
    );

    // Convert to CrimeObservation[]
    const periodStart = `${maxYear}-01-01`;
    const periodEnd = `${maxYear}-12-31`;
    const observations: CrimeObservation[] = [];

    const emitRow = (geoAreaId: string, counts: Counts) => {
      for (const [colName, category] of Object.entries(COLUMN_CATEGORY_MAP)) {
        const count = colName === 'Violent_sum' ? counts.violent
          : colName === 'Property_sum' ? counts.property
          : counts.vehicle;

        if (count === 0) continue;

        observations.push({
          sourceId: 'ca_doj',
          geoAreaId,
          periodStart,
          periodEnd,
          category,
          incidentCount: count,
          rawCategory: colName,
        });
      }
    };

    for (const [cityLower, counts] of cityData) {
      emitRow(`city:${slugify(cityLower)}`, counts);
    }
    for (const [countyLower, counts] of countyData) {
      emitRow(`county:${slugify(countyLower)}`, counts);
    }
    emitRow('state:california', stateCounts);

    console.log(
      `  CA DOJ: ${observations.length} observations (cities=${cityData.size}, counties=${countyData.size}, state=1)`
    );
    return observations;
  },
};

// Re-export the station-city mapping for use in the orchestrator's legacy backfill
export { STATION_CITY };
