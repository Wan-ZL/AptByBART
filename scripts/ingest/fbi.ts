/**
 * FBI Crime Data Explorer (CDE) ingester
 * Source: api.usa.gov/crime/fbi/sapi
 * Requires FBI_API_KEY env var (free from api.data.gov/signup)
 * Granularity: city (via ORI code) or state fallback
 * geo_area_id format: city:<slug> or state:california
 */

import type { CrimeIngester, CrimeObservation, CrimeCategory } from '../../lib/crime-taxonomy';

const API_BASE = 'https://api.usa.gov/crime/fbi/sapi';

const OFFENSE_MAP: Record<string, CrimeCategory> = {
  'violent-crime': 'violent',
  'property-crime': 'property',
  'motor-vehicle-theft': 'vehicle',
};

// Bay Area city ORI codes (FBI's Originating Agency Identifier)
// These are well-known ORIs for major Bay Area agencies
const BAY_AREA_ORIS: Record<string, string> = {
  'CA0380100': 'san_francisco',   // SFPD
  'CA0010200': 'oakland',          // OPD
  'CA0010300': 'berkeley',         // Berkeley PD
  'CA0130100': 'richmond',         // Richmond PD
  'CA0070200': 'concord',          // Concord PD
  'CA0430100': 'san_jose',         // SJPD
  'CA0010900': 'fremont',          // Fremont PD
  'CA0010800': 'hayward',          // Hayward PD
  'CA0411100': 'daly_city',        // Daly City PD
  'CA0411300': 'south_san_francisco', // South SF PD
  'CA0411000': 'san_bruno',        // San Bruno PD
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

    // 1. Fetch state-level CA data as a baseline
    console.log(`  FBI: fetching CA state-level data for ${targetYear}`);
    for (const [offense, category] of Object.entries(OFFENSE_MAP)) {
      try {
        const data = await fetchFBI(
          `/api/summarized/state/CA/${offense}?from=${targetYear}&to=${targetYear}`,
          apiKey
        );

        // The response is an object with a results array
        const results = data?.results ?? data;
        if (Array.isArray(results) && results.length > 0) {
          const total = results.reduce(
            (sum: number, r: any) => sum + (Number(r.actual) || 0),
            0
          );
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
        }
      } catch (err) {
        console.warn(`  FBI: state-level ${offense} failed: ${(err as Error).message}`);
      }
    }

    // 2. Try to fetch city-level data via ORI codes
    console.log('  FBI: fetching city-level data via ORI codes');
    for (const [ori, citySlug] of Object.entries(BAY_AREA_ORIS)) {
      for (const [offense, category] of Object.entries(OFFENSE_MAP)) {
        try {
          const data = await fetchFBI(
            `/api/summarized/agencies/${ori}/${offense}?from=${targetYear}&to=${targetYear}`,
            apiKey
          );

          const results = data?.results ?? data;
          if (Array.isArray(results) && results.length > 0) {
            const total = results.reduce(
              (sum: number, r: any) => sum + (Number(r.actual) || 0),
              0
            );
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
          }
        } catch (err) {
          // City-level failures are expected — many agencies don't report
          console.warn(`  FBI: ${citySlug} ${offense} failed: ${(err as Error).message}`);
        }
      }
    }

    console.log(`  FBI: ${observations.length} observations total`);
    return observations;
  },
};
