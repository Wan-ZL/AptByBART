/**
 * CA DOJ OpenJustice CSV ingester
 * Source: Crimes & Clearances with Arson (1985-2023)
 * Granularity: city
 * geo_area_id format: city:<slug> (e.g., city:san_francisco)
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

function slugify(city: string): string {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
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
    const ncicIdx = header.findIndex(h => h === 'NCICCode' || h === 'NCIC_Code');
    const violentIdx = header.indexOf('Violent_sum');
    const propertyIdx = header.indexOf('Property_sum');
    const vehicleIdx = header.indexOf('VehicleTheft_sum');

    if (yearIdx === -1 || violentIdx === -1 || propertyIdx === -1) {
      throw new Error(`Missing expected columns. Found: ${header.slice(0, 15).join(', ')}`);
    }

    const cityColIdx = ncicIdx !== -1 ? ncicIdx : header.indexOf('County');
    if (cityColIdx === -1) {
      throw new Error('Cannot find city/agency column (NCICCode or County)');
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

    // Aggregate by city for the most recent year
    const cityData = new Map<string, { violent: number; property: number; vehicle: number }>();

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseCSVLine(lines[i]);
      const year = parseInt(cols[yearIdx], 10);
      if (year !== maxYear) continue;

      const cityRaw = cols[cityColIdx];
      if (!cityRaw) continue;
      const cityLower = cityRaw.trim().toLowerCase();
      if (!TARGET_CITIES.has(cityLower)) continue;

      const violent = parseInt(cols[violentIdx], 10) || 0;
      const property = parseInt(cols[propertyIdx], 10) || 0;
      const vehicle = vehicleIdx !== -1 ? (parseInt(cols[vehicleIdx], 10) || 0) : 0;

      const existing = cityData.get(cityLower);
      if (existing) {
        existing.violent += violent;
        existing.property += property;
        existing.vehicle += vehicle;
      } else {
        cityData.set(cityLower, { violent, property, vehicle });
      }
    }

    console.log(`  Found data for ${cityData.size} target cities`);

    // Convert to CrimeObservation[]
    const periodStart = `${maxYear}-01-01`;
    const periodEnd = `${maxYear}-12-31`;
    const observations: CrimeObservation[] = [];

    for (const [cityLower, counts] of cityData) {
      const geoAreaId = `city:${slugify(cityLower)}`;

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
    }

    console.log(`  CA DOJ: ${observations.length} observations across ${cityData.size} cities`);
    return observations;
  },
};

// Re-export the station-city mapping for use in the orchestrator's legacy backfill
export { STATION_CITY };
