/**
 * Richmond PD ingester — Socrata dataset t3nu-7bbq on www.transparentrichmond.org
 * Dataset: "Richmond Police Department - Crime Incidents"
 * Granularity: city (no lat/lng in dataset, only street block + zip)
 * geo_area_id: city:richmond
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';
import { fetchSocrata } from './socrata-client';

interface RichmondRow {
  offense_grouping: string;
  cnt: string;
}

export const richmondIngester: CrimeIngester = {
  sourceId: 'richmond',
  sourceName: 'Richmond PD Crime Incidents',
  apiType: 'socrata',
  granularity: 'city',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const sinceDate = oneYearAgo.toISOString().slice(0, 10);

    const periodStart = sinceDate;
    const periodEnd = now.toISOString().slice(0, 10);

    console.log(`  Richmond: fetching crimes since ${sinceDate}`);

    const rows = (await fetchSocrata({
      domain: 'www.transparentrichmond.org',
      datasetId: 't3nu-7bbq',
      select: 'offense_grouping, count(*) as cnt',
      where: `offensedateutc > '${sinceDate}'`,
      group: 'offense_grouping',
      limit: 50000,
    })) as unknown as RichmondRow[];

    console.log(`  Richmond: received ${rows.length} aggregated rows`);

    const observations: CrimeObservation[] = [];
    const unmapped = new Set<string>();

    for (const row of rows) {
      if (!row.offense_grouping) continue;

      const category = mapCategory('richmond', row.offense_grouping);
      if (!category) {
        unmapped.add(row.offense_grouping);
        continue;
      }

      observations.push({
        sourceId: 'richmond',
        geoAreaId: 'city:richmond',
        periodStart,
        periodEnd,
        category,
        incidentCount: parseInt(String(row.cnt), 10) || 0,
        rawCategory: row.offense_grouping,
      });
    }

    if (unmapped.size > 0) {
      console.warn(`  Richmond: ${unmapped.size} unmapped categories: ${Array.from(unmapped).join(', ')}`);
    }

    console.log(`  Richmond: produced ${observations.length} observations`);
    return observations;
  },
};
