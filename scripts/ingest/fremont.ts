/**
 * Fremont PD ingester — STUB.
 *
 * TODO: Fremont does not operate a public open data portal (no data.fremont.gov,
 * no Socrata federation entry). Fremont PD publishes incidents via CrimeMapping.com,
 * which has no documented public API. Options to revisit:
 *   1. Reverse-engineer CrimeMapping's internal JSON endpoint (ToS risk).
 *   2. PIP CA DOJ OpenJustice city-level totals (annual, already covered by ca-doj.ts).
 *   3. File a public records request for a monthly CSV export.
 *
 * Until a source is confirmed, this ingester returns an empty observation set so
 * the orchestrator can register it without crashing.
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';

export const fremontIngester: CrimeIngester = {
  sourceId: 'fremont',
  sourceName: 'Fremont PD',
  apiType: 'csv_download',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Fremont: no public data source available — returning empty set');
    return [];
  },
};
