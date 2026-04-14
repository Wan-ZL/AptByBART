/**
 * Oakland CrimeWatch ingester — Socrata dataset ppgh-7dqv on data.oaklandca.gov
 * Granularity: police beat (35 beats)
 * geo_area_id format: beat:<beat_id> (e.g., beat:12x)
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';
import { fetchSocrata } from './socrata-client';

interface OaklandRow {
  policebeat: string;
  crimetype: string;
  cnt: string;
}

export const oaklandIngester: CrimeIngester = {
  sourceId: 'oakland',
  sourceName: 'Oakland CrimeWatch',
  apiType: 'socrata',
  granularity: 'beat',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const sinceDate = oneYearAgo.toISOString().slice(0, 10);

    const periodStart = sinceDate;
    const periodEnd = now.toISOString().slice(0, 10);

    console.log(`  Oakland: fetching crimes since ${sinceDate}`);

    const rows = (await fetchSocrata({
      domain: 'data.oaklandca.gov',
      datasetId: 'ppgh-7dqv',
      select: 'policebeat, crimetype, count(*) as cnt',
      where: `datetime > '${sinceDate}'`,
      group: 'policebeat, crimetype',
      limit: 50000,
    })) as unknown as OaklandRow[];

    console.log(`  Oakland: received ${rows.length} aggregated rows`);

    const observations: CrimeObservation[] = [];
    const unmapped = new Set<string>();

    for (const row of rows) {
      if (!row.policebeat || !row.crimetype) continue;

      const category = mapCategory('oakland', row.crimetype);
      if (!category) {
        unmapped.add(row.crimetype);
        continue;
      }

      observations.push({
        sourceId: 'oakland',
        geoAreaId: `beat:${row.policebeat.toLowerCase()}`,
        periodStart,
        periodEnd,
        category,
        incidentCount: parseInt(String(row.cnt), 10) || 0,
        rawCategory: row.crimetype,
      });
    }

    if (unmapped.size > 0) {
      console.warn(`  Oakland: ${unmapped.size} unmapped categories: ${Array.from(unmapped).join(', ')}`);
    }

    console.log(`  Oakland: produced ${observations.length} observations`);
    return observations;
  },
};
