/**
 * Alameda County Sheriff ingester — ArcGIS FeatureServer feed
 * ("Crime Reports Jul2022 Present", ACSO). Covers Dublin + unincorporated
 * Alameda County (Castro Valley, Ashland, Cherryland, San Lorenzo, Sunol,
 * Fairview). City-PD jurisdictions occasionally appear in the feed but the
 * ingester only keeps ACSO-authoritative records to avoid double-counting
 * with other city ingesters.
 *
 * Dataset about page:
 *   https://opendata-acgov.hub.arcgis.com/datasets/53a54eb59d5f42038e80098384ba5156_2/about
 * FeatureServer:
 *   https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Crime_Reports_Jul2022_Present/FeatureServer/2
 *
 * Granularity: census tract (via PIP against public/census-tracts.geojson,
 * restricted to GEOIDs 06001* = Alameda County). Fallback:
 *   - `city:<slug>` for records that PIP-miss but have a recognizable City value
 *   - `county:alameda` when nothing else sticks
 *
 * Category mapping uses the NIBRS group code trailer of CrimeDescription
 * (e.g. "... F - 13A Aggravated Assault" → "13A"). Records without a parsable
 * trailer, or whose trailer is 90Z (All Other Offenses), are skipped.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';
import type { CrimeIngester, CrimeObservation } from '../../lib/crime-taxonomy';
import { mapCategory } from '../../lib/crime-taxonomy';

const FEATURE_SERVER =
  'https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Crime_Reports_Jul2022_Present/FeatureServer/2';
const PAGE_SIZE = 2000;
const MAX_PAGES = 50; // 100k rows hard cap; feed is ~12k total since Jul 2022

// Records whose City value is one of these are emitted by a city-PD ingester
// already, so we drop them to avoid double-counting (Alameda PD, Oakland PD,
// Berkeley PD, Fremont PD, Hayward PD, San Leandro PD, Union City PD,
// Pleasanton PD, Livermore PD, Piedmont PD, Newark PD, Albany PD, Emeryville
// PD). ACSO still shows up for these cities for mutual-aid / booked arrests,
// but the primary-agency source already has those incidents.
const CITY_PD_JURISDICTIONS = new Set([
  'alameda',
  'albany',
  'berkeley',
  'emeryville',
  'fremont',
  'hayward',
  'livermore',
  'newark',
  'oakland',
  'piedmont',
  'pleasanton',
  'san leandro',
  'union city',
]);

// Cities / CDPs where ACSO IS the primary agency — used as city:<slug>
// fallback when PIP can't attribute a point to a specific tract.
const ACSO_CITY_SLUGS: Record<string, string> = {
  dublin: 'dublin',
  'castro valley': 'castro-valley',
  'san lorenzo': 'san-lorenzo',
  ashland: 'ashland',
  cherryland: 'cherryland',
  fairview: 'fairview',
  sunol: 'sunol',
};

interface TractFeature {
  type: 'Feature';
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  properties: { GEOID: string; parentCity?: string };
}

interface TractGeoJson {
  type: 'FeatureCollection';
  features: TractFeature[];
}

interface ArcgisFeature {
  type: 'Feature';
  geometry?: { type: 'Point'; coordinates: [number, number] } | null;
  properties: {
    OBJECTID?: number;
    DateTime?: number | null;
    City?: string | null;
    CrimeDescription?: string | null;
    AgencyId?: string | null;
  };
}

interface ArcgisResponse {
  type: 'FeatureCollection';
  features: ArcgisFeature[];
  properties?: { exceededTransferLimit?: boolean };
}

function loadAlamedaTracts(): TractFeature[] {
  const path = resolve(__dirname, '..', '..', 'public', 'census-tracts.geojson');
  const geo = JSON.parse(readFileSync(path, 'utf-8')) as TractGeoJson;
  return geo.features.filter((f) => f.properties?.GEOID?.startsWith('06001'));
}

function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  // Canonicalize common typos / abbreviations we saw in the feed.
  const typos: Record<string, string> = {
    'castr valley': 'castro valley',
    'castro valrly': 'castro valley',
    'castro vallry': 'castro valley',
    'castro valey': 'castro valley',
    'casto valley': 'castro valley',
    cas: 'castro valley',
    hawyward: 'hayward',
    hawyard: 'hayward',
    ha: 'hayward',
    oakkland: 'oakland',
    oak: 'oakland',
    oa: 'oakland',
    du: 'dublin',
    fr: 'fremont',
    li: 'livermore',
    sl: 'san leandro',
    alco: 'alameda county',
    'alameda county': 'alameda county',
    'livermore-pleasanton': 'livermore',
    'pleasanton sunol and verona rd': 'sunol',
  };
  return typos[trimmed] ?? trimmed;
}

// Extract the NIBRS group code (e.g. "13A", "120", "35A") from the
// CrimeDescription trailer. Pattern: "... - <CODE> <group name>".
function extractNibrsCode(desc: string | null | undefined): string | null {
  if (!desc) return null;
  // Match the LAST " - CODE ..." segment; CODE = 2-3 digits optionally followed
  // by a single letter suffix.
  const m = desc.match(/-\s+(\d{2,3}[A-Z]?)\s+[A-Za-z]/);
  return m ? m[1] : null;
}

async function fetchPage(offset: number): Promise<ArcgisResponse> {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const since = oneYearAgo.toISOString().slice(0, 19).replace('T', ' ');

  const url = new URL(`${FEATURE_SERVER}/query`);
  url.searchParams.set('where', `DateTime > TIMESTAMP '${since}'`);
  url.searchParams.set('outFields', 'OBJECTID,DateTime,City,CrimeDescription,AgencyId');
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('resultOffset', String(offset));
  url.searchParams.set('resultRecordCount', String(PAGE_SIZE));
  url.searchParams.set('orderByFields', 'OBJECTID ASC');
  url.searchParams.set('outSR', '4326');

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ArcGIS HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as ArcgisResponse;
}

export const alamedaSheriffIngester: CrimeIngester = {
  sourceId: 'alameda_sheriff',
  sourceName: "Alameda County Sheriff's Office Crime Reports",
  apiType: 'rest_api',
  granularity: 'tract',
  updateFrequency: 'daily',

  async fetch(): Promise<CrimeObservation[]> {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const periodStart = oneYearAgo.toISOString().slice(0, 10);
    const periodEnd = now.toISOString().slice(0, 10);

    console.log(`  Alameda Sheriff: fetching incidents since ${periodStart}`);

    const tracts = loadAlamedaTracts();
    console.log(`  Alameda Sheriff: ${tracts.length} Alameda County tracts loaded for PIP`);

    const rows: ArcgisFeature[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      let resp: ArcgisResponse;
      try {
        resp = await fetchPage(offset);
      } catch (err) {
        console.warn(`  Alameda Sheriff: page ${page} failed (${(err as Error).message})`);
        break;
      }
      rows.push(...resp.features);
      if (!resp.properties?.exceededTransferLimit || resp.features.length < PAGE_SIZE) break;
    }

    console.log(`  Alameda Sheriff: received ${rows.length} incident rows`);

    const buckets = new Map<
      string,
      { geoAreaId: string; category: CrimeObservation['category']; rawCategory: string; count: number }
    >();
    const unmapped = new Set<string>();
    let cityPdSkipped = 0;
    let noCode = 0;
    let pipMisses = 0;
    let noGeo = 0;

    for (const row of rows) {
      const city = normalizeCity(row.properties.City);
      if (city && CITY_PD_JURISDICTIONS.has(city)) {
        cityPdSkipped += 1;
        continue;
      }

      const code = extractNibrsCode(row.properties.CrimeDescription);
      if (!code) {
        noCode += 1;
        continue;
      }
      const category = mapCategory('alameda_sheriff', code);
      if (!category) {
        unmapped.add(code);
        continue;
      }

      const coords = row.geometry?.coordinates;
      let geoAreaId: string;
      if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
        const [lng, lat] = coords;
        const pt = turfPoint([lng, lat]);
        const hit = tracts.find((t) =>
          booleanPointInPolygon(pt, t as unknown as Parameters<typeof booleanPointInPolygon>[1])
        );
        if (hit) {
          geoAreaId = `tract:${hit.properties.GEOID}`;
        } else {
          pipMisses += 1;
          geoAreaId = city && ACSO_CITY_SLUGS[city] ? `city:${ACSO_CITY_SLUGS[city]}` : 'county:alameda';
        }
      } else {
        noGeo += 1;
        geoAreaId = city && ACSO_CITY_SLUGS[city] ? `city:${ACSO_CITY_SLUGS[city]}` : 'county:alameda';
      }

      const key = `${geoAreaId}|${category}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, { geoAreaId, category, rawCategory: code, count: 1 });
      }
    }

    const observations: CrimeObservation[] = [];
    for (const b of buckets.values()) {
      observations.push({
        sourceId: 'alameda_sheriff',
        geoAreaId: b.geoAreaId,
        periodStart,
        periodEnd,
        category: b.category,
        incidentCount: b.count,
        rawCategory: b.rawCategory,
      });
    }

    if (cityPdSkipped > 0) {
      console.log(`  Alameda Sheriff: ${cityPdSkipped} incidents dropped (covered by city-PD ingester)`);
    }
    if (noCode > 0) {
      console.log(`  Alameda Sheriff: ${noCode} incidents with no NIBRS code in description`);
    }
    if (unmapped.size > 0) {
      console.warn(
        `  Alameda Sheriff: ${unmapped.size} unmapped NIBRS codes: ${Array.from(unmapped).join(', ')}`
      );
    }
    if (pipMisses > 0) {
      console.log(`  Alameda Sheriff: ${pipMisses} incidents outside any Alameda tract (fallback to city/county)`);
    }
    if (noGeo > 0) {
      console.log(`  Alameda Sheriff: ${noGeo} incidents without coordinates (fallback to city/county)`);
    }

    console.log(`  Alameda Sheriff: produced ${observations.length} observations`);
    return observations;
  },
};
