/**
 * San Jose PD ingester — CKAN datastore on data.sanjoseca.gov
 * Package: police-calls-for-service (annual CSV resources, CKAN datastore-enabled)
 * Granularity: city (no lat/lng in schema — only block-level address strings)
 * geo_area_id: city:san_jose
 *
 * Schema notes:
 *   - CALL_TYPE: human-readable offense (e.g. "BATTERY", "STOLEN VEHICLE")
 *   - OFFENSE_DATE: ISO timestamp for incident
 *   - ADDRESS: "[300]-[400] E SANTA CLARA ST" style block range (not geocoded)
 *
 * Because there's no lat/lng, spatial attribution to census tracts would require
 * geocoding every block address. For now we aggregate at city level so the data
 * is still usable for San Jose area stations.
 */

import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';

// Annual CKAN resource IDs — covers rolling 365 day window
const RESOURCES: { year: number; id: string }[] = [
  { year: 2026, id: 'dc0ec99c-0c6b-45fb-b1ec-faf072fe4833' },
  { year: 2025, id: '0bc5ea69-fcc7-4998-ab6c-70c3a0df778b' },
];

const CKAN_SQL_URL = 'https://data.sanjoseca.gov/api/3/action/datastore_search_sql';

interface SjpdAggRow {
  CALL_TYPE: string;
  cnt: string | number;
}

interface CkanSqlResponse {
  success: boolean;
  error?: { message?: string };
  result?: { records?: SjpdAggRow[] };
}

async function fetchAggregated(resourceId: string, sinceIso: string): Promise<SjpdAggRow[]> {
  // CKAN datastore_search_sql supports standard PostgreSQL SQL
  // Quote identifiers with double quotes; wrap string literals with single quotes
  const sql = `SELECT "CALL_TYPE", COUNT(*) as cnt FROM "${resourceId}" WHERE "OFFENSE_DATE" >= '${sinceIso}' GROUP BY "CALL_TYPE"`;
  const url = `${CKAN_SQL_URL}?sql=${encodeURIComponent(sql)}`;

  console.log(`  SJPD: querying resource ${resourceId} since ${sinceIso}`);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SJPD CKAN HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as CkanSqlResponse;
  if (!json.success) {
    throw new Error(`SJPD CKAN error: ${json.error?.message ?? 'unknown'}`);
  }
  return json.result?.records ?? [];
}

export const sjpdIngester: CrimeIngester = {
  sourceId: 'sjpd',
  sourceName: 'San Jose PD Calls for Service',
  apiType: 'rest_api',
  granularity: 'city',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const sinceDate = oneYearAgo.toISOString().slice(0, 10);
    const periodStart = sinceDate;
    const periodEnd = now.toISOString().slice(0, 10);

    // Merge counts across annual resources by category
    const totals = new Map<string, { category: ReturnType<typeof mapCategory>; count: number }>();
    const unmapped = new Set<string>();

    for (const { year, id } of RESOURCES) {
      let rows: SjpdAggRow[] = [];
      try {
        rows = await fetchAggregated(id, sinceDate);
      } catch (err) {
        console.warn(`  SJPD: resource ${year} fetch failed: ${(err as Error).message}`);
        continue;
      }
      console.log(`  SJPD: ${year} returned ${rows.length} aggregated rows`);

      for (const row of rows) {
        const raw = row.CALL_TYPE;
        if (!raw) continue;
        const category = mapCategory('sjpd', raw);
        if (!category) {
          unmapped.add(raw);
          continue;
        }
        const existing = totals.get(raw);
        const n = parseInt(String(row.cnt), 10) || 0;
        if (existing) {
          existing.count += n;
        } else {
          totals.set(raw, { category, count: n });
        }
      }
    }

    const observations: CrimeObservation[] = [];
    for (const [rawCategory, { category, count }] of totals) {
      if (!category || count === 0) continue;
      observations.push({
        sourceId: 'sjpd',
        geoAreaId: 'city:san_jose',
        periodStart,
        periodEnd,
        category,
        incidentCount: count,
        rawCategory,
      });
    }

    if (unmapped.size > 0) {
      const sample = Array.from(unmapped).slice(0, 10).join(', ');
      console.warn(`  SJPD: ${unmapped.size} unmapped call types (sample: ${sample})`);
    }

    console.log(`  SJPD: produced ${observations.length} observations (city-level)`);
    return observations;
  },
};
