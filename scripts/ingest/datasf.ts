import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';
import { fetchSocrata } from './socrata-client';

export const datasfIngester: CrimeIngester = {
  sourceId: 'datasf',
  sourceName: 'SF DataSF (SFPD Incidents)',
  apiType: 'socrata',
  granularity: 'neighborhood',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    // Aggregate incidents by neighborhood + category for last 12 months
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const dateStr = oneYearAgo.toISOString().split('T')[0]; // YYYY-MM-DD

    const rows = await fetchSocrata({
      domain: 'data.sfgov.org',
      datasetId: 'wg3w-h783',
      select: 'analysis_neighborhood, incident_category, count(*) as cnt',
      where: `incident_datetime > '${dateStr}T00:00:00' AND analysis_neighborhood IS NOT NULL`,
      group: 'analysis_neighborhood, incident_category',
      order: 'cnt DESC',
      limit: 50000,
    });

    const observations: CrimeObservation[] = [];
    const periodStart = dateStr;
    const periodEnd = new Date().toISOString().split('T')[0];

    for (const row of rows) {
      const neighborhood = row.analysis_neighborhood as string;
      const rawCategory = row.incident_category as string;
      const count = Number(row.cnt) || 0;

      if (!neighborhood || !rawCategory || count === 0) continue;

      const category = mapCategory('datasf', rawCategory);
      if (!category) continue;

      const slug = neighborhood
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+$/, '');

      observations.push({
        sourceId: 'datasf',
        geoAreaId: `neighborhood:${slug}`,
        periodStart,
        periodEnd,
        category,
        incidentCount: count,
        rawCategory,
      });
    }

    console.log(`  DataSF: ${observations.length} observations from ${rows.length} rows`);
    return observations;
  },
};
