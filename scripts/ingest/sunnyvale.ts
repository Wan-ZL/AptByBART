/**
 * Sunnyvale DPS ingester — STUB (no usable public historical crime data)
 *
 * As of 2026-04-18, Sunnyvale Department of Public Safety has no public-facing
 * crime / calls-for-service feed that supports a 365-day ingest:
 *
 *   1. data.sunnyvale.ca.gov — domain times out on direct connections and is
 *      not indexed by the Socrata federated catalog
 *      (api.us.socrata.com/api/catalog/v1?domains=data.sunnyvale.ca.gov returns
 *      "Domain not found"). A probe to https://data.sunnyvale.ca.gov/ 301-redirects
 *      to www.socrata.com, suggesting the portal is decommissioned or unrouted.
 *
 *   2. Sunnyvale ArcGIS REST — https://gis.sunnyvale.ca.gov/arcgis/rest/services
 *      exposes a DPS folder (DPS/DPS MapServer) but its layers are all reference
 *      polygons / POIs (SV PreFire, Traffic Cameras, City Facility, Public Safety
 *      Facility, High Rise Buildings, Police Report Districts, Fire Report
 *      District, Fire Districts). No incident / CFS / crime feature service is
 *      exposed. No hub.arcgis.com datasets are published under a SunnyvaleCA org.
 *
 *   3. Santa Clara County Socrata (data.sccgov.org, dataset n9u6-aijz) only
 *      contains Sheriff-reported incidents — filtering by upper(city)='SUNNYVALE'
 *      returns 0 rows, because DPS is an independent agency and does not report
 *      into the county feed.
 *
 *   4. FBI CDE (fbi.ts) already covers Sunnyvale DPS at annual UCR granularity
 *      via the agency ORI lookup, so there is no gap in long-window coverage.
 *
 *   5. CA DOJ OpenJustice (ca-doj.ts) covers Sunnyvale at city granularity for
 *      annual violent/property/vehicle totals.
 *
 * Spatial strategy (when a source is found): lat/lng → PIP against
 * public/census-tracts.geojson via @turf/boolean-point-in-polygon →
 * geoAreaId `tract:<GEOID>`. Fallback to `city:sunnyvale`.
 *
 * TODO: Revisit periodically. If DPS publishes an incident feed (ArcGIS
 * FeatureServer, SPIDR/CrimeReports export, or revived Socrata portal),
 * follow the oakland.ts + PIP pattern and add a 'sunnyvale' mapping to
 * SOURCE_CATEGORY_MAPS in lib/crime-taxonomy.ts.
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';

export const sunnyvaleIngester: CrimeIngester = {
  sourceId: 'sunnyvale',
  sourceName: 'Sunnyvale DPS (stub)',
  apiType: 'rest_api',
  granularity: 'city',
  updateFrequency: 'annual',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Sunnyvale: no usable public open data source — skipping');
    return [];
  },
};
