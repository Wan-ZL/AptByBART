/**
 * Concord PD ingester — STUB
 *
 * Concord CA publishes a public crime map dashboard built on ArcGIS Experience
 * Builder (https://gis.cityofconcord.org/crimemapdashboard, which redirects to
 * https://experience.arcgis.com/experience/f7b4ed6ed8c642458deaeb97385ec27d).
 * The dashboard is not a documented open-data portal: there is no Socrata
 * instance at data.cityofconcord.org, the ArcGIS REST root
 * (gis.cityofconcord.org/arcgis/rest/services) returns 401, and the Police
 * Department pages only advertise yearly PDF "Crime Statistics" reports plus a
 * Records Unit phone line (925-671-3240) for data requests.
 *
 * TODO: reverse-engineer the FeatureServer layer backing the Experience
 * Builder app (inspect its network requests for a services.arcgis.com/<org>/
 * ArcGIS/rest/services/<crime_layer>/FeatureServer/0/query URL), then wire up
 * an ArcGIS query similar to what we'd do for other ESRI-hosted feeds. Until
 * then this ingester returns no observations so orchestrator.ts stays a no-op.
 *
 * Granularity when implemented: likely reporting district (police beat);
 * geo_area_id format: beat:concord-<id>.
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';

export const concordIngester: CrimeIngester = {
  sourceId: 'concord',
  sourceName: 'Concord PD Crime Map',
  apiType: 'rest_api',
  granularity: 'beat',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    console.log('  Concord: stub — no public API discovered, returning 0 observations');
    return [];
  },
};
