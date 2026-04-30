/**
 * FBI Crime Data Explorer (CDE) ingester
 * Source: api.usa.gov/crime/fbi/cde
 * Requires FBI_API_KEY env var (free from api.data.gov/signup)
 * Granularity: city (via ORI code) with state fallback
 * geo_area_id format: city:<slug> or state:california
 */

import type { CrimeIngester, CrimeObservation, CrimeCategory } from '../../lib/crime-taxonomy';

const API_BASE = 'https://api.usa.gov/crime/fbi/cde';

const OFFENSE_MAP: Record<string, CrimeCategory> = {
  'violent-crime': 'violent',
  'property-crime': 'property',
  'motor-vehicle-theft': 'vehicle',
};

// Bay Area city ORI codes (FBI Originating Agency Identifier)
// Verified via FBI CDE agency directory (api.usa.gov/crime/fbi/cde/agency/byStateAbbr/CA)
const BAY_AREA_ORIS: Record<string, string> = {
  // San Francisco County
  'CA0380100': 'san_francisco',

  // Alameda County
  'CA0010900': 'oakland',
  'CA0010300': 'berkeley',
  'CA0010500': 'fremont',
  'CA0010600': 'hayward',
  'CA0010700': 'livermore',
  'CA0010100': 'alameda',
  'CA0011100': 'pleasanton',
  'CA0011200': 'san_leandro',
  'CA001300X': 'dublin',

  // Contra Costa County
  'CA0070400': 'concord',
  'CA0071000': 'richmond',
  'CA0071200': 'walnut_creek',

  // Santa Clara County
  'CA0431300': 'san_jose',
  'CA0431200': 'palo_alto',
  'CA0431100': 'mountain_view',
  'CA0431400': 'santa_clara',
  'CA0431600': 'sunnyvale',
  'CA0430800': 'milpitas',
  'CA0430300': 'cupertino',

  // San Mateo County
  'CA0410600': 'daly_city',
  'CA0411300': 'redwood_city',
  'CA0411400': 'san_bruno',
  'CA0411600': 'san_mateo',
  'CA0411700': 'south_san_francisco',
  'CA0412700': 'east_palo_alto',

  // Marin County
  'CA0210900': 'san_rafael',

  // Napa County
  'CA0280200': 'napa',

  // Solano County
  'CA0480300': 'fairfield',
  'CA0480700': 'vallejo',
};

async function fetchFBI(path: string, apiKey: string): Promise<any> {
  const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}API_KEY=${apiKey}`;
  console.log(`  FBI GET ${path}`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FBI API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Sum the "actuals" section of the CDE summarized response.
 * Response shape: { offenses: { actuals: { "<Agency> Offenses": { "MM-YYYY": number, ... } } } }
 *
 * Scope selects which series to include:
 *   'agency' — city/agency call: keep "<Agency> Offenses", drop California / United States rollups.
 *   'state'  — state call: keep only "California Offenses"; drop the United States national baseline.
 */
function sumActuals(data: any, scope: 'agency' | 'state'): number {
  const actuals = data?.offenses?.actuals;
  if (!actuals || typeof actuals !== 'object') return 0;

  let total = 0;
  for (const [seriesKey, monthMap] of Object.entries(actuals)) {
    if (!seriesKey.endsWith('Offenses')) continue;

    if (scope === 'state') {
      if (!seriesKey.startsWith('California')) continue;
    } else {
      if (seriesKey.startsWith('California') || seriesKey.startsWith('United States')) continue;
    }

    if (!monthMap || typeof monthMap !== 'object') continue;
    for (const v of Object.values(monthMap as Record<string, number>)) {
      total += Number(v) || 0;
    }
  }
  return Math.round(total);
}

export const fbiIngester: CrimeIngester = {
  sourceId: 'fbi',
  sourceName: 'FBI Crime Data Explorer',
  apiType: 'rest_api',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    const apiKey = process.env.FBI_API_KEY;
    if (!apiKey) {
      console.log('  FBI: FBI_API_KEY not set, skipping');
      return [];
    }

    const observations: CrimeObservation[] = [];
    const currentYear = new Date().getFullYear();
    // FBI data typically lags 1-2 years
    const targetYear = currentYear - 2;
    const periodStart = `${targetYear}-01-01`;
    const periodEnd = `${targetYear}-12-31`;
    const from = `01-${targetYear}`;
    const to = `12-${targetYear}`;

    // 1. State-level CA baseline
    console.log(`  FBI: fetching CA state-level data for ${targetYear}`);
    for (const [offense, category] of Object.entries(OFFENSE_MAP)) {
      try {
        const data = await fetchFBI(
          `/summarized/state/CA/${offense}?from=${from}&to=${to}`,
          apiKey
        );
        const total = sumActuals(data, 'state');
        if (total > 0) {
          observations.push({
            sourceId: 'fbi',
            geoAreaId: 'state:california',
            periodStart,
            periodEnd,
            category,
            incidentCount: total,
            rawCategory: offense,
          });
        }
      } catch (err) {
        console.warn(`  FBI: state-level ${offense} failed: ${(err as Error).message}`);
      }
    }

    // 2. City-level via ORI
    console.log('  FBI: fetching city-level data via ORI codes');
    for (const [ori, citySlug] of Object.entries(BAY_AREA_ORIS)) {
      for (const [offense, category] of Object.entries(OFFENSE_MAP)) {
        try {
          const data = await fetchFBI(
            `/summarized/agency/${ori}/${offense}?from=${from}&to=${to}`,
            apiKey
          );
          const total = sumActuals(data, 'agency');
          if (total > 0) {
            observations.push({
              sourceId: 'fbi',
              geoAreaId: `city:${citySlug}`,
              periodStart,
              periodEnd,
              category,
              incidentCount: total,
              rawCategory: offense,
            });
          }
        } catch (err) {
          console.warn(`  FBI: ${citySlug} ${offense} failed: ${(err as Error).message}`);
        }
      }
    }

    console.log(`  FBI: ${observations.length} observations total`);
    return observations;
  },
};
