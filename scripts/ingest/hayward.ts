/**
 * Hayward PD ingester — STUB
 *
 * TODO: No public crime data API found as of 2026-04-18.
 *   - hayward-ca.gov has no open data portal (data.hayward-ca.gov unreachable, /open-data 404)
 *   - Police department page lists no crime statistics, CrimeMapping.com, or CommunityCrimeMap links
 *   - Only path to data: Public Records Act request (manual, not automatable)
 * Revisit options:
 *   - Check https://www.crimemapping.com for Hayward agency (needs manual verification)
 *   - Check https://communitycrimemap.com (LexisNexis) for Hayward participation
 *   - FBI UCR / CA DOJ city-level annual totals (already covered by ca-doj.ts)
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';

export const haywardIngester: CrimeIngester = {
  sourceId: 'hayward',
  sourceName: 'Hayward PD',
  apiType: 'rest_api',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Hayward: no public API available — skipping (see TODO in hayward.ts)');
    return [];
  },
};
