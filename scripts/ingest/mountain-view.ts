/**
 * Mountain View PD ingester — STUB (no public crime data available)
 *
 * As of 2026-04-18, Mountain View Police Department does not publish open
 * crime data via a public API or data portal. There is no `data.mountainview.gov`
 * Socrata/ArcGIS endpoint, and the city's performance site does not expose
 * incident-level or aggregated crime datasets. MVPD publishes only a static
 * "Crime Information" page with links to third-party aggregators (which are
 * not machine-readable and have restrictive ToS).
 *
 * TODO: Revisit periodically. Options if data becomes available:
 *   - City open data portal (preferred): follow oakland.ts pattern with
 *     PIP against census tract polygons; else fallback to `city:mountain_view`.
 *   - LexisNexis Community Crime Map / CrimeMapping.com: scraping likely
 *     violates ToS; not recommended.
 *   - CA DOJ OpenJustice: already covered by ca-doj ingester at city
 *     granularity — no need to duplicate.
 *
 * granularity would be 'city' if/when implemented; geo_area_id: city:mountain_view
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';

export const mountainViewIngester: CrimeIngester = {
  sourceId: 'mountain_view',
  sourceName: 'Mountain View PD (stub)',
  apiType: 'rest_api',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Mountain View: no public open data source available — skipping');
    return [];
  },
};
