/**
 * Palo Alto PD ingester — STUB (no usable public historical crime data)
 *
 * As of 2026-04-18, Palo Alto PD has two public-facing data surfaces, neither
 * of which supports a 365-day crime/CFS ingest:
 *
 *   1. ArcGIS "Agency Common Event" MapServer — public, no auth:
 *        https://gis.cityofpaloalto.org/server/rest/services/PublicSafety/AgencyCommonEvent/MapServer
 *      Layers 1 ("0 to 4 hours") + 2 ("4 to 24 hours") expose only a rolling
 *      24-hour window of calls (~15 records at snapshot time). Fields:
 *      CALLTIME, CALLTYPE, CALLTYPEDESCRIPTION, CALLSUBTYPE, INCIDENTSTATUS,
 *      INCIDENTNUMBER, CROSSSTREET, SHAPE(polygon). Date range is far too
 *      short to produce meaningful aggregates.
 *
 *   2. Junar open data portal (data.cityofpaloalto.org) — currently returning
 *      HTTP 404 on all paths tested (portal appears down or decommissioned).
 *      The annual "Crime Reports" / "Calls for Service" dataviews referenced
 *      by the Police Data Initiative (https://goo.gl/j46VbF → dataview 95541)
 *      are unreachable, and the Junar cloudapi endpoint
 *      (paloalto.cloudapi.junar.com) requires `auth_key` — returns 403
 *      NotAuthenticated without one.
 *
 * CA DOJ OpenJustice (ca-doj ingester) already covers Palo Alto at city
 * granularity for annual UCR-style totals, so there is no gap in coverage.
 *
 * TODO: Revisit periodically. If the Junar portal comes back online or an
 * auth key is obtained, follow the oakland.ts pattern with PIP against
 * census tract polygons (lat/lng → tract), else fallback to `city:palo_alto`.
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';

export const paloAltoIngester: CrimeIngester = {
  sourceId: 'palo_alto',
  sourceName: 'Palo Alto PD (stub)',
  apiType: 'rest_api',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Palo Alto: no usable public open data source — skipping');
    return [];
  },
};
