/**
 * Marin County ingester — Socrata dataset ahxi-5nsc on data.marincounty.gov
 * Granularity: county (all incidents aggregated into one area)
 * geo_area_id: county:marin
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';
import { fetchSocrata } from './socrata-client';

interface MarinRow {
  crime: string;
  cnt: string;
}

export const marinIngester: CrimeIngester = {
  sourceId: 'marin',
  sourceName: 'Marin County Crime Data',
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

    console.log(`  Marin: fetching crimes since ${sinceDate}`);

    const rows = (await fetchSocrata({
      domain: 'data.marincounty.gov',
      datasetId: 'ahxi-5nsc',
      select: 'crime, count(*) as cnt',
      where: `incident_date_time > '${sinceDate}'`,
      group: 'crime',
      limit: 50000,
    })) as unknown as MarinRow[];

    console.log(`  Marin: received ${rows.length} aggregated rows`);

    const observations: CrimeObservation[] = [];
    const unmapped = new Set<string>();

    for (const row of rows) {
      if (!row.crime) continue;

      const category = mapCategory('marin', row.crime);
      if (!category) {
        unmapped.add(row.crime);
        continue;
      }

      observations.push({
        sourceId: 'marin',
        geoAreaId: 'county:marin',
        periodStart,
        periodEnd,
        category,
        incidentCount: parseInt(String(row.cnt), 10) || 0,
        rawCategory: row.crime,
      });
    }

    if (unmapped.size > 0) {
      console.warn(`  Marin: ${unmapped.size} unmapped categories: ${Array.from(unmapped).join(', ')}`);
    }

    console.log(`  Marin: produced ${observations.length} observations`);
    return observations;
  },
};
