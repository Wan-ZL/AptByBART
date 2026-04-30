/**
 * Clip census tract polygons in public/census-tracts.geojson to land only.
 * Subtracts Census TIGER 2022 Area Water polygons (loaded from
 * public/bay-area-water-census.geojson) from each tract using turf.difference.
 * Idempotent — a second run produces the same output (within 0.1% tolerance).
 *
 * Per-tract bbox prefilter keeps runtime proportional to the number of
 * water polygons that actually overlap each tract, not the full 3.5k set.
 *
 * Usage: npm run clip:tracts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon, featureCollection } from "@turf/helpers";
import { difference as turfDifference } from "@turf/difference";
import turfArea from "@turf/area";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

function simplifyCoords(coords: unknown): unknown {
  if (typeof coords === "number") {
    return Math.round(coords * 100000) / 100000;
  }
  if (Array.isArray(coords)) {
    return coords.map(simplifyCoords);
  }
  return coords;
}

function toTurfFeature(feature: Feature): Feature<Polygon | MultiPolygon> | null {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type === "Polygon") {
    return turfPolygon(geom.coordinates as number[][][], feature.properties ?? {});
  }
  if (geom.type === "MultiPolygon") {
    return turfMultiPolygon(geom.coordinates as number[][][][], feature.properties ?? {});
  }
  return null;
}

interface Bbox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

function geometryBbox(geom: Polygon | MultiPolygon): Bbox {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring as [number, number][]) {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    }
  }
  return { xmin, ymin, xmax, ymax };
}

function bboxOverlaps(a: Bbox, b: Bbox): boolean {
  return a.xmax >= b.xmin && a.xmin <= b.xmax && a.ymax >= b.ymin && a.ymin <= b.ymax;
}

interface WaterItem {
  feature: Feature<Polygon | MultiPolygon>;
  bbox: Bbox;
}

function loadWaterItems(path: string): WaterItem[] {
  const raw = readFileSync(path, "utf-8");
  const fc = JSON.parse(raw) as FeatureCollection;
  const items: WaterItem[] = [];
  for (const f of fc.features) {
    const geom = f.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const poly = geom as Polygon | MultiPolygon;
    const turf =
      poly.type === "Polygon"
        ? turfPolygon(poly.coordinates as number[][][], f.properties ?? {})
        : turfMultiPolygon(poly.coordinates as number[][][][], f.properties ?? {});
    items.push({ feature: turf, bbox: geometryBbox(poly) });
  }
  return items;
}

type ClipOutcome =
  | { kind: "unchanged"; feature: Feature }
  | { kind: "clipped"; feature: Feature; areaBefore: number; areaAfter: number }
  | { kind: "removed"; name: string; areaBefore: number }
  | { kind: "skipped"; name: string; reason: string };

function clipOne(feature: Feature, water: WaterItem[]): ClipOutcome {
  const name = String(
    feature.properties?.GEOID ||
      feature.properties?.NAME ||
      feature.properties?.name ||
      "?"
  );

  const tract = toTurfFeature(feature);
  if (!tract) {
    return { kind: "skipped", name, reason: `unsupported geometry: ${feature.geometry?.type}` };
  }

  let areaBefore = 0;
  try {
    areaBefore = turfArea(tract);
  } catch (e) {
    return { kind: "skipped", name, reason: `area failed: ${(e as Error).message}` };
  }

  // Build the subset of water polygons whose bbox overlaps this tract. This
  // keeps the difference operation proportional to the ~local water count
  // rather than the 3.5k total water features for the whole region.
  const tractBbox = geometryBbox(tract.geometry as Polygon | MultiPolygon);
  const overlapping: Feature<Polygon | MultiPolygon>[] = [];
  for (const w of water) {
    if (bboxOverlaps(tractBbox, w.bbox)) overlapping.push(w.feature);
  }

  if (overlapping.length === 0) {
    return { kind: "unchanged", feature };
  }

  // Apply each overlapping water polygon in sequence via turf.difference.
  // Union-then-difference is tempting but @turf/union of hundreds of sprawling
  // water polygons is expensive and often fails on self-touching rings;
  // iterated difference is robust and keeps per-tract work small since only a
  // handful of water polygons overlap any given tract.
  let current: Feature<Polygon | MultiPolygon> | null = tract;
  for (const w of overlapping) {
    if (!current) break;
    try {
      current = turfDifference(featureCollection([current, w])) as
        | Feature<Polygon | MultiPolygon>
        | null;
    } catch (e) {
      return { kind: "skipped", name, reason: `difference failed: ${(e as Error).message}` };
    }
  }

  if (!current) {
    return { kind: "removed", name, areaBefore };
  }

  let areaAfter = 0;
  try {
    areaAfter = turfArea(current);
  } catch {
    areaAfter = areaBefore;
  }

  const relDiff = areaBefore > 0 ? Math.abs(areaAfter - areaBefore) / areaBefore : 0;
  if (relDiff < 0.001) {
    return { kind: "unchanged", feature };
  }

  const clipped: Feature = {
    type: "Feature",
    geometry: {
      type: current.geometry.type,
      coordinates: simplifyCoords(current.geometry.coordinates) as any,
    } as Polygon | MultiPolygon,
    properties: feature.properties ?? {},
  };
  return { kind: "clipped", feature: clipped, areaBefore, areaAfter };
}

async function main() {
  const inputPath = join(process.cwd(), "public", "census-tracts.geojson");
  const waterPath = join(process.cwd(), "public", "bay-area-water-census.geojson");

  console.log(`Loading water mask from ${waterPath}...`);
  const water = loadWaterItems(waterPath);
  console.log(`  Loaded ${water.length} water polygons`);

  console.log(`\nReading ${inputPath}...`);
  const raw = readFileSync(inputPath, "utf-8");
  const fc = JSON.parse(raw) as FeatureCollection;
  const total = fc.features.length;
  console.log(`Loaded ${total} tract features.\n`);

  const outFeatures: Feature[] = [];
  let modified = 0;
  let removed = 0;
  let skipped = 0;
  let areaBeforeTotal = 0;
  let areaReducedTotal = 0;
  const removedNames: string[] = [];
  const skippedNotes: string[] = [];

  let processed = 0;
  for (const feature of fc.features) {
    const outcome = clipOne(feature, water);
    switch (outcome.kind) {
      case "unchanged":
        outFeatures.push(outcome.feature);
        try {
          const t = toTurfFeature(outcome.feature);
          if (t) areaBeforeTotal += turfArea(t);
        } catch {}
        break;
      case "clipped":
        outFeatures.push(outcome.feature);
        modified++;
        areaBeforeTotal += outcome.areaBefore;
        areaReducedTotal += outcome.areaBefore - outcome.areaAfter;
        break;
      case "removed":
        removed++;
        removedNames.push(outcome.name);
        areaBeforeTotal += outcome.areaBefore;
        areaReducedTotal += outcome.areaBefore;
        break;
      case "skipped":
        skipped++;
        skippedNotes.push(`${outcome.name}: ${outcome.reason}`);
        outFeatures.push(feature);
        break;
    }
    processed++;
    if (processed % 200 === 0) {
      console.log(`  Processed ${processed}/${total}`);
    }
  }

  const output: FeatureCollection = {
    type: "FeatureCollection",
    features: outFeatures,
  };
  const json = JSON.stringify(output);
  writeFileSync(inputPath, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  const km2Before = areaBeforeTotal / 1e6;
  const km2Reduced = areaReducedTotal / 1e6;
  const pct = areaBeforeTotal > 0 ? (areaReducedTotal / areaBeforeTotal) * 100 : 0;

  console.log("\n--- Results ---");
  console.log(`Total tracts:       ${total}`);
  console.log(`Modified (clipped): ${modified}`);
  console.log(`Removed (all water):${removed}`);
  console.log(`Skipped (errors):   ${skipped}`);
  console.log(`Output features:    ${outFeatures.length}`);
  console.log(`Area before:        ${km2Before.toFixed(1)} km²`);
  console.log(`Area reduction:     ${km2Reduced.toFixed(1)} km² (${pct.toFixed(2)}%)`);
  console.log(`Output file:        ${inputPath} (${sizeMB} MB)`);

  if (removedNames.length > 0) {
    console.log(`\nRemoved tracts (${removedNames.length}):`);
    console.log(`  ${removedNames.slice(0, 20).join(", ")}${removedNames.length > 20 ? ", ..." : ""}`);
  }
  if (skippedNotes.length > 0) {
    console.log(`\nSkipped tracts (${skippedNotes.length}):`);
    for (const note of skippedNotes.slice(0, 20)) console.log(`  - ${note}`);
    if (skippedNotes.length > 20) console.log(`  ... and ${skippedNotes.length - 20} more`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
