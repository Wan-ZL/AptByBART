/**
 * Fetch Bay Area city/town boundary polygons from OpenStreetMap via the
 * Overpass API. Converts OSM relation geometry into GeoJSON polygons.
 * Outputs a FeatureCollection to public/bay-area-cities.geojson with
 * land-only boundaries (no water areas).
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon, featureCollection } from "@turf/helpers";
import { difference as turfDifference } from "@turf/difference";
import { union as turfUnion } from "@turf/union";

// Bay Area bounding box: south, west, north, east
const BBOX = "37.1,-122.7,38.1,-121.5";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Simplify coordinate precision to 5 decimal places (~1m accuracy)
function simplifyCoords(coords: unknown): unknown {
  if (typeof coords === "number") {
    return Math.round(coords * 100000) / 100000;
  }
  if (Array.isArray(coords)) {
    return coords.map(simplifyCoords);
  }
  return coords;
}

async function fetchOverpass(query: string, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = attempt * 15;
      console.log(`  Retrying in ${wait}s (attempt ${attempt + 1}/${retries + 1})...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }

    console.log("Sending Overpass query...");
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (res.status === 429 || res.status === 504) {
      console.warn(`  Got ${res.status}, will retry...`);
      if (attempt === retries) {
        throw new Error(`Overpass API ${res.status} after ${retries + 1} attempts`);
      }
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Overpass API ${res.status}: ${text.slice(0, 500)}`);
    }

    return res.json();
  }
}

interface OsmMember {
  type: string;
  ref: number;
  role: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OsmElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: OsmMember[];
}

/**
 * Assemble outer/inner way geometries from a relation into GeoJSON rings.
 * Handles the case where multiple ways need to be joined end-to-end.
 */
function assembleRings(
  members: OsmMember[],
  role: "outer" | "inner"
): number[][][] {
  const ways = members
    .filter((m) => m.type === "way" && m.role === role && m.geometry?.length)
    .map((m) =>
      m.geometry!.map((p) => [p.lon, p.lat])
    );

  if (ways.length === 0) return [];

  // Join ways that share endpoints into complete rings
  const rings: number[][][] = [];
  const remaining = [...ways];

  while (remaining.length > 0) {
    const ring = remaining.shift()!;

    let joined = true;
    while (joined) {
      joined = false;
      const ringStart = ring[0];
      const ringEnd = ring[ring.length - 1];

      // Check if ring is already closed
      if (
        Math.abs(ringStart[0] - ringEnd[0]) < 1e-7 &&
        Math.abs(ringStart[1] - ringEnd[1]) < 1e-7 &&
        ring.length > 3
      ) {
        break;
      }

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const cStart = candidate[0];
        const cEnd = candidate[candidate.length - 1];

        const matchEndToStart =
          Math.abs(ringEnd[0] - cStart[0]) < 1e-7 &&
          Math.abs(ringEnd[1] - cStart[1]) < 1e-7;
        const matchEndToEnd =
          Math.abs(ringEnd[0] - cEnd[0]) < 1e-7 &&
          Math.abs(ringEnd[1] - cEnd[1]) < 1e-7;
        const matchStartToEnd =
          Math.abs(ringStart[0] - cEnd[0]) < 1e-7 &&
          Math.abs(ringStart[1] - cEnd[1]) < 1e-7;
        const matchStartToStart =
          Math.abs(ringStart[0] - cStart[0]) < 1e-7 &&
          Math.abs(ringStart[1] - cStart[1]) < 1e-7;

        if (matchEndToStart) {
          ring.push(...candidate.slice(1));
          remaining.splice(i, 1);
          joined = true;
          break;
        } else if (matchEndToEnd) {
          ring.push(...candidate.slice(0, -1).reverse());
          remaining.splice(i, 1);
          joined = true;
          break;
        } else if (matchStartToEnd) {
          ring.unshift(...candidate.slice(0, -1));
          remaining.splice(i, 1);
          joined = true;
          break;
        } else if (matchStartToStart) {
          ring.unshift(...candidate.slice(1).reverse());
          remaining.splice(i, 1);
          joined = true;
          break;
        }
      }
    }

    // Ensure ring is closed
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (
      Math.abs(first[0] - last[0]) > 1e-7 ||
      Math.abs(first[1] - last[1]) > 1e-7
    ) {
      ring.push([...first]);
    }

    if (ring.length >= 4) {
      rings.push(ring);
    }
  }

  return rings;
}

function relationToGeoJSON(element: OsmElement): any | null {
  if (!element.members || !element.tags?.name) return null;

  const outerRings = assembleRings(element.members, "outer");
  const innerRings = assembleRings(element.members, "inner");

  if (outerRings.length === 0) return null;

  let geometry: any;
  if (outerRings.length === 1 && innerRings.length === 0) {
    geometry = {
      type: "Polygon",
      coordinates: [outerRings[0]],
    };
  } else if (outerRings.length === 1) {
    geometry = {
      type: "Polygon",
      coordinates: [outerRings[0], ...innerRings],
    };
  } else {
    // MultiPolygon: each outer ring is a separate polygon
    // Try to assign inner rings to the correct outer ring
    const polygons: number[][][][] = outerRings.map((outer) => [outer]);

    for (const inner of innerRings) {
      // Find which outer ring contains this inner ring (use first point)
      const testPoint = inner[0];
      let assigned = false;
      for (const poly of polygons) {
        if (pointInRing(testPoint, poly[0])) {
          poly.push(inner);
          assigned = true;
          break;
        }
      }
      if (!assigned && polygons.length > 0) {
        polygons[0].push(inner);
      }
    }

    geometry = {
      type: "MultiPolygon",
      coordinates: polygons,
    };
  }

  return {
    type: "Feature",
    geometry: {
      type: geometry.type,
      coordinates: simplifyCoords(geometry.coordinates),
    },
    properties: {
      NAME: element.tags.name,
    },
  };
}

// Simple ray-casting point-in-polygon test
function pointInRing(point: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Returns a hardcoded polygon covering SF Bay, San Pablo Bay, and adjacent
 * waters. Traced from known shoreline landmarks. More reliable than OSM
 * bay relations which often have gaps.
 */
function getBayWaterPolygon(): any {
  console.log("Using hardcoded bay water polygon...");

  // Clockwise trace of the bay shoreline (lng, lat)
  // Starting at Golden Gate, going south along SF/Peninsula shore,
  // east across South Bay, north along East Bay shore, west across
  // San Pablo Bay, and back to Golden Gate.
  const bayCoords: [number, number][] = [
    // Golden Gate entrance
    [-122.4786, 37.8103],
    // SF waterfront — tight to actual shoreline
    [-122.4589, 37.8050],
    [-122.4320, 37.8060],
    [-122.4170, 37.8080],
    [-122.4100, 37.8088],
    [-122.3980, 37.7960],
    [-122.3930, 37.7880],
    [-122.3910, 37.7780],
    [-122.3900, 37.7700],
    [-122.3880, 37.7520],
    [-122.3850, 37.7380],
    [-122.3830, 37.7280],
    [-122.3870, 37.7130],
    [-122.3900, 37.6880],
    [-122.3850, 37.6500],
    [-122.3800, 37.6200],
    [-122.3550, 37.5900],
    [-122.2800, 37.5600],
    [-122.2200, 37.5100],
    [-122.1600, 37.4700],
    [-122.1100, 37.4400],
    // South Bay (bottom)
    [-122.0500, 37.4150],
    [-122.0000, 37.4100],
    [-121.9400, 37.4300],
    // East shore — tight to actual waterfront
    [-122.0200, 37.4800],
    [-122.0700, 37.5100],
    [-122.0900, 37.5400],
    [-122.1100, 37.5800],
    [-122.1300, 37.6200],
    [-122.1500, 37.6500],
    [-122.1700, 37.6800],
    [-122.2000, 37.7100],
    [-122.2200, 37.7300],
    [-122.2400, 37.7500],
    [-122.2550, 37.7650],
    [-122.2700, 37.7800],
    [-122.2750, 37.7950],
    [-122.2800, 37.8100],
    [-122.2900, 37.8300],
    [-122.3050, 37.8500],
    [-122.3100, 37.8700],
    [-122.3100, 37.8900],
    [-122.3300, 37.9100],
    // San Pablo Bay (going west) — generous coverage
    [-122.3500, 37.9300],
    [-122.3700, 37.9500],
    [-122.4000, 37.9700],
    [-122.4300, 37.9700],
    [-122.4600, 37.9600],
    [-122.4900, 37.9400],
    // Marin side (going south back to Golden Gate)
    [-122.5100, 37.9200],
    [-122.4900, 37.9000],
    [-122.4800, 37.8800],
    [-122.4700, 37.8700],
    [-122.4600, 37.8600],
    [-122.4700, 37.8400],
    [-122.4786, 37.8200],
    // Close polygon
    [-122.4786, 37.8103],
  ];

  const poly = turfPolygon([bayCoords]);
  console.log(`  Bay polygon: ${bayCoords.length} points`);
  return poly;
}

/**
 * Clip a city GeoJSON feature by subtracting the water polygon.
 * Returns the clipped feature, or the original if clipping fails.
 */
function clipFeatureByWater(feature: any, waterPolygon: any): any {
  try {
    const geom = feature.geometry;
    let cityPoly: any;

    if (geom.type === "Polygon") {
      cityPoly = turfPolygon(geom.coordinates);
    } else if (geom.type === "MultiPolygon") {
      cityPoly = turfMultiPolygon(geom.coordinates);
    } else {
      return feature;
    }

    const result = turfDifference(featureCollection([cityPoly, waterPolygon]));

    if (!result) {
      // Entire polygon was water — unlikely for cities but handle gracefully
      return feature;
    }

    return {
      ...feature,
      geometry: {
        type: result.geometry.type,
        coordinates: simplifyCoords(result.geometry.coordinates),
      },
    };
  } catch (e) {
    // If clipping fails (invalid geometry, etc.), keep original
    console.warn(`  Warning: clipping failed for ${feature.properties?.NAME}: ${e}`);
    return feature;
  }
}

async function main() {
  console.log("Fetching Bay Area city boundaries from OpenStreetMap...\n");

  // Use "out geom" to get geometry directly on each relation,
  // avoiding the need for a separate node/way download pass.
  // Include admin_level=6 for San Francisco (consolidated city-county)
  // and admin_level=8 for all other cities/towns.
  const query = `[out:json][timeout:300];
(
  relation["boundary"="administrative"]["admin_level"="8"]["name"](${BBOX});
  relation["boundary"="administrative"]["admin_level"="6"]["border_type"="city"]["name"](${BBOX});
);
out geom;`;

  const osmData = await fetchOverpass(query);

  const relations = osmData.elements?.filter(
    (e: any) => e.type === "relation"
  ) || [];
  console.log(`Received ${relations.length} relations from Overpass API`);

  // Convert each relation to a GeoJSON feature
  const features: any[] = [];
  const failed: string[] = [];

  for (const rel of relations) {
    const feature = relationToGeoJSON(rel);
    if (feature) {
      features.push(feature);
    } else {
      failed.push(rel.tags?.name || `relation/${rel.id}`);
    }
  }

  console.log(
    `Converted: ${features.length} features (${failed.length} failed)`
  );
  if (failed.length > 0) {
    console.log(`  Failed: ${failed.join(", ")}`);
  }

  // Clip city polygons to remove water areas (SF Bay, San Pablo Bay)
  console.log("\n--- Water Clipping ---");
  const waterPolygon = getBayWaterPolygon();

  if (waterPolygon) {
    console.log(`\nClipping ${features.length} city polygons against bay water...`);
    for (let i = 0; i < features.length; i++) {
      const name = features[i].properties?.NAME;
      const before = features[i];
      features[i] = clipFeatureByWater(features[i], waterPolygon);
      if (features[i] !== before) {
        // Log only cities that were actually modified
        const bType = before.geometry.type;
        const aType = features[i].geometry.type;
        if (bType !== aType) {
          console.log(`  Clipped: ${name} (${bType} -> ${aType})`);
        }
      }
    }
    console.log("Water clipping complete.\n");
  } else {
    console.warn("Skipping water clipping: no bay polygon available.\n");
  }

  const geoJson = {
    type: "FeatureCollection",
    features,
  };

  const outPath = join(process.cwd(), "public", "bay-area-cities.geojson");
  const json = JSON.stringify(geoJson);
  writeFileSync(outPath, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(
    `\nSaved to ${outPath} (${sizeMB} MB, ${features.length} cities)`
  );

  // Print all city names
  const names = features.map((f: any) => f.properties.NAME).sort();
  console.log(`\nCities in output (${names.length}):`);
  for (const name of names) {
    console.log(`  - ${name}`);
  }

  // Verify key cities are present
  const keyCities = [
    "San Francisco",
    "Oakland",
    "Berkeley",
    "San Jose",
    "Fremont",
    "Palo Alto",
    "Daly City",
  ];
  const missing = keyCities.filter(
    (c) => !names.some((n: string) => n.toLowerCase() === c.toLowerCase())
  );
  if (missing.length > 0) {
    console.warn(`\nWARNING: Missing expected cities: ${missing.join(", ")}`);
  } else {
    console.log("\nAll key Bay Area cities present");
  }

  // Check file size
  if (parseFloat(sizeMB) > 3) {
    console.warn(
      `\nWARNING: File size ${sizeMB} MB exceeds 3 MB target. Consider further simplification.`
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
