/**
 * Santa Clara County ingester — Socrata dataset n9u6-aijz on data.sccgov.org
 * Granularity: county (all incidents aggregated into one area)
 * geo_area_id: county:santa_clara
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';
import { fetchSocrata } from './socrata-client';

interface SantaClaraRow {
  incident_type_primary: string;
  cnt: string;
}

export const santaClaraIngester: CrimeIngester = {
  sourceId: 'santa_clara',
  sourceName: 'Santa Clara County Crime Data',
  apiType: 'socrata',
  granularity: 'county',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const sinceDate = oneYearAgo.toISOString().slice(0, 10);

    const periodStart = sinceDate;
    const periodEnd = now.toISOString().slice(0, 10);

    console.log(`  Santa Clara: fetching crimes since ${sinceDate}`);

    const rows = (await fetchSocrata({
      domain: 'data.sccgov.org',
      datasetId: 'n9u6-aijz',
      select: 'incident_type_primary, count(*) as cnt',
      where: `incident_datetime > '${sinceDate}'`,
      group: 'incident_type_primary',
      limit: 50000,
    })) as unknown as SantaClaraRow[];

    console.log(`  Santa Clara: received ${rows.length} aggregated rows`);

    const observations: CrimeObservation[] = [];
    const unmapped = new Set<string>();

    for (const row of rows) {
      if (!row.incident_type_primary) continue;

      const category = mapCategory('santa_clara', row.incident_type_primary);
      if (!category) {
        unmapped.add(row.incident_type_primary);
        continue;
      }

      observations.push({
        sourceId: 'santa_clara',
        geoAreaId: 'county:santa_clara',
        periodStart,
        periodEnd,
        category,
        incidentCount: parseInt(String(row.cnt), 10) || 0,
        rawCategory: row.incident_type_primary,
      });
    }

    if (unmapped.size > 0) {
      console.warn(`  Santa Clara: ${unmapped.size} unmapped categories: ${Array.from(unmapped).join(', ')}`);
    }

    console.log(`  Santa Clara: produced ${observations.length} observations`);
    return observations;
  },
};
