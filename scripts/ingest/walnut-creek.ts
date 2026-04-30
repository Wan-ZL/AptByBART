/**
 * Walnut Creek PD ingester — stub
 *
 * TODO: Walnut Creek does not publish a direct crime data API.
 *   - No Socrata / open data portal at walnutcreekca.gov (checked 2026-04)
 *   - walnut-creek.org redirects to walnutcreekca.gov (no data.* subdomain)
 *   - City publishes periodic stats pages but no structured feed
 *   - CrimeMapping.com participation unconfirmed — requires manual verification
 *
 * Candidate future sources:
 *   1. Contra Costa County sheriff open data (covers unincorporated + contract cities)
 *   2. FBI UCR / CDE annual data (already ingested globally via ca-doj / fbi)
 *   3. CrimeMapping.com scrape (if agency is found to participate)
 *   4. City PD annual PDF reports (last resort, manual)
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';

export const walnutCreekIngester: CrimeIngester = {
  sourceId: 'walnut-creek',
  sourceName: 'Walnut Creek PD',
  apiType: 'rest_api',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Walnut Creek: no direct API available, skipping (stub)');
    return [];
  },
};
