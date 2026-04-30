/**
 * Berkeley PD ingester — Socrata dataset k2nh-s5h5 on data.cityofberkeley.info
 * ("Berkeley PD - Calls for Service", rolling ~180-day window; we request 365 but
 * will only get what the portal exposes).
 *
 * Granularity: census tract via point-in-polygon against public/census-tracts.geojson
 *   → geo_area_id format: tract:<GEOID> (e.g., tract:06001422100)
 * Fallback for incidents without usable coordinates or outside all tracts:
 *   → geo_area_id format: city:berkeley
 *
 * Incident-level fetch (not pre-aggregated) because we need the point to PIP.
 * Category mapping uses the dataset's CVLEGEND field, which is the pre-normalized
 * "legend" category (broader than OFFENSE). See lib/crime-taxonomy.ts → berkeley.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';
import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';
import { fetchSocrata } from './socrata-client';

interface BerkeleyRow {
  caseno?: string;
  eventdt?: string;
  cvlegend?: string;
  offense?: string;
  blkaddr?: string;
  block_location?:
    | string
    | {
        type: 'Point';
        coordinates: [number, number]; // [lng, lat] per GeoJSON
      };
  latitude?: string;
  longitude?: string;
}

interface TractFeature {
  type: 'Feature';
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  properties: { GEOID: string; parentCity?: string };
}

interface TractGeoJson {
  type: 'FeatureCollection';
  features: TractFeature[];
}

function loadBerkeleyTracts(): TractFeature[] {
  const path = resolve(__dirname, '..', '..', 'public', 'census-tracts.geojson');
  const geo = JSON.parse(readFileSync(path, 'utf-8')) as TractGeoJson;
  // Berkeley is in Alameda County (FIPS 001). Restrict PIP candidates to
  // Berkeley tracts to keep lookups fast and avoid mis-attributing a point
  // that happens to fall just inside a neighboring-city tract.
  return geo.features.filter((f) => f.properties?.parentCity === 'Berkeley');
}

function extractLatLng(row: BerkeleyRow): [number, number] | null {
  const loc = row.block_location;
  if (loc && typeof loc === 'object' && Array.isArray(loc.coordinates)) {
    const [lng, lat] = loc.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  // Some datasets expose flat latitude/longitude columns alongside the point.
  if (row.latitude && row.longitude) {
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  // Fallback: parse "... (lat, lng)" tail of the combined string form.
  if (typeof loc === 'string') {
    const m = loc.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    }
  }
  return null;
}

export const berkeleyIngester: CrimeIngester = {
  sourceId: 'berkeley',
  sourceName: 'Berkeley PD - Calls for Service',
  apiType: 'socrata',
  granularity: 'neighborhood',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const sinceDate = oneYearAgo.toISOString().slice(0, 10);

    const periodStart = sinceDate;
    const periodEnd = now.toISOString().slice(0, 10);

    console.log(`  Berkeley: fetching incidents since ${sinceDate}`);

    const tracts = loadBerkeleyTracts();
    console.log(`  Berkeley: ${tracts.length} candidate tracts loaded`);

    // Paginate — Socrata caps at 50k/request. A full year of Berkeley calls
    // is typically <50k but we keep the loop so the ingester survives a spike.
    const pageSize = 50000;
    let offset = 0;
    const rows: BerkeleyRow[] = [];
    while (true) {
      const page = (await fetchSocrata({
        domain: 'data.cityofberkeley.info',
        datasetId: 'k2nh-s5h5',
        select: 'caseno, eventdt, cvlegend, offense, blkaddr, block_location',
        where: `eventdt > '${sinceDate}T00:00:00'`,
        order: 'eventdt',
        limit: pageSize,
        offset,
      })) as unknown as BerkeleyRow[];

      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    console.log(`  Berkeley: received ${rows.length} incident rows`);

    // Aggregate: (geoAreaId, category) → incidentCount.
    const buckets = new Map<
      string,
      { geoAreaId: string; category: CrimeObservation['category']; rawCategory: string; count: number }
    >();
    const unmapped = new Set<string>();
    let pipMisses = 0;
    let noGeo = 0;

    for (const row of rows) {
      const raw = row.cvlegend?.trim() || row.offense?.trim();
      if (!raw) continue;

      const category = mapCategory('berkeley', raw);
      if (!category) {
        unmapped.add(raw);
        continue;
      }

      const coords = extractLatLng(row);
      let geoAreaId = 'city:berkeley';
      if (coords) {
        const [lat, lng] = coords;
        const pt = turfPoint([lng, lat]);
        const hit = tracts.find((t) =>
          booleanPointInPolygon(pt, t as unknown as Parameters<typeof booleanPointInPolygon>[1])
        );
        if (hit) {
          geoAreaId = `tract:${hit.properties.GEOID}`;
        } else {
          pipMisses += 1;
        }
      } else {
        noGeo += 1;
      }

      const key = `${geoAreaId}|${category}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, { geoAreaId, category, rawCategory: raw, count: 1 });
      }
    }

    const observations: CrimeObservation[] = [];
    for (const b of buckets.values()) {
      observations.push({
        sourceId: 'berkeley',
        geoAreaId: b.geoAreaId,
        periodStart,
        periodEnd,
        category: b.category,
        incidentCount: b.count,
        rawCategory: b.rawCategory,
      });
    }

    if (unmapped.size > 0) {
      console.warn(
        `  Berkeley: ${unmapped.size} unmapped categories: ${Array.from(unmapped).slice(0, 20).join(', ')}`
      );
    }
    if (pipMisses > 0) {
      console.log(`  Berkeley: ${pipMisses} incidents outside any Berkeley tract (rolled up to city:berkeley)`);
    }
    if (noGeo > 0) {
      console.log(`  Berkeley: ${noGeo} incidents with no coordinates (rolled up to city:berkeley)`);
    }

    console.log(`  Berkeley: produced ${observations.length} observations`);
    return observations;
  },
};
