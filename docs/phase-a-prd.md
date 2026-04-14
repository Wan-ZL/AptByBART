# Phase A PRD: Unified Neighborhood Safety Visualization + Per-Capita Scoring

**Author:** Product Team  
**Date:** 2026-04-11  
**Status:** Draft  
**Target branch:** `feat/phase-a-unified-safety`

---

## 1. Overview & Goals

AptByBART displays a crime/safety choropleth overlay on a MapLibre map, but the current implementation suffers from two critical problems: (1) colors change when zooming because city-level data (CA DOJ) at low zoom cross-fades into neighborhood-level data (DataSF/Oakland) at high zoom, with different sources producing different scores for the same area; (2) 20 of 22 BART cities show nothing at high zoom because only SF and Oakland have neighborhood-level data — the city layer fades out and nothing replaces it. Phase A replaces the two-layer crossfade with a single unified GeoJSON layer where every area is rendered at neighborhood granularity, colors never change across zoom levels, and per-capita normalization makes scores comparable across areas of wildly different population sizes.

### Goals

- **Consistent colors at every zoom level.** One GeoJSON source, one MapLibre fill layer, visible from zoom 0 to 22. No crossfade. The color a user sees for an area at zoom 9 is identical at zoom 14.
- **Full coverage at all zoom levels.** When zooming into any of the 22 BART cities, the user always sees colored polygons — SF neighborhoods, Oakland beats, or census tracts for the other 20 cities.
- **Per-capita scoring.** Safety scores use `incidents / population * 10,000` instead of raw incident counts, so a small city with 50 crimes is not scored the same as a large city with 50 crimes.
- **Census tract proxies for 20 cities.** Cities without neighborhood-level crime data are subdivided into Census Tracts. Each tract inherits the city-level per-capita rate (since CA DOJ only provides city-level totals). This provides visual granularity (you see tract boundaries) even though the data is uniform within a city.

### Non-Goals

- **No heatmap layer.** The heatmap layer (`safety-heatmap-layer`, `/api/safety/heatmap`) is removed from scope. Neighborhood choropleth is the only visualization.
- **No trend sparklines.** Crime trend visualization is deferred to Phase B.
- **No new data sources.** We are not adding new crime data providers. DataSF, Oakland CrimeWatch, and CA DOJ remain the three sources.
- **No county-level display.** County polygons (Marin, Santa Clara) are excluded from the unified layer; only city/neighborhood/beat/tract polygons render.
- **No real-time updates.** The existing daily/annual update cadence is unchanged.

---

## 2. User Stories

1. **As a renter searching in San Leandro**, I want to see colored safety polygons when I zoom into the city (currently it goes blank), so I can visually assess safety without guessing.

2. **As a renter comparing SF and Fremont**, I want the safety scores to be normalized by population, so a score of 7 in SF means roughly the same thing as a score of 7 in Fremont.

3. **As a renter zooming from the Bay overview down to a specific neighborhood**, I want the polygon colors to stay the same as I zoom, so I don't get confused by colors changing at zoom level 11-12.

4. **As a renter clicking a census tract in San Jose**, I want to see a detail panel that clearly explains this area is showing city-level data (not neighborhood-specific data), so I understand the data granularity.

5. **As a power user adjusting safety weight presets**, I want the per-capita recalculation to work correctly with the new scoring model, so custom weights still produce meaningful comparisons.

---

## 3. Data Architecture

### 3a. Census Tract Boundaries

**Source:** U.S. Census Bureau TIGER/Line Shapefiles, available as GeoJSON from the Census TIGERweb REST API.

**API endpoint:**
```
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/8/query
  ?where=STATE='06' AND COUNTY IN ('001','013','041','043','075','081','085')
  &outFields=GEOID,NAME,COUNTY,AREALAND
  &f=geojson
  &outSR=4326
  &returnGeometry=true
```

**County FIPS codes for our 7 Bay Area counties:**

| County | FIPS |
|--------|------|
| Alameda | 001 |
| Contra Costa | 013 |
| Marin | 041 |
| San Mateo | 081 |
| Santa Clara | 085 |
| San Francisco | 075 |
| Solano | 043 |

**Filtering to our 20 target cities:** After downloading all tracts for these counties, filter by spatial intersection with the city boundary polygons from `public/bay-area-cities.geojson`. A tract is "in" a city if the centroid of the tract falls within the city polygon. Tracts that don't fall within any of the 20 target cities are discarded.

**20 target cities** (all BART cities except SF and Oakland, which already have finer-grained data):
Antioch, Berkeley, Concord, Daly City, Dublin, El Cerrito, Fremont, Hayward, Lafayette, Milpitas, Orinda, Pittsburg, Pleasant Hill, Richmond, San Bruno, San Jose, San Leandro, South San Francisco, Union City, Walnut Creek.

**Expected tract count:** ~350-500 tracts across the 20 cities.

**Output properties per tract feature:**
```typescript
{
  GEOID: string;     // e.g., "06001400100" (state + county + tract)
  NAME: string;      // e.g., "Census Tract 4001" (human-readable)
  COUNTY: string;    // FIPS code
  AREALAND: number;  // land area in sq meters (used to exclude water-only tracts)
}
```

**Exclude tracts** where `AREALAND === 0` (water-only tracts like those in the Bay).

### 3b. Population Data

**Source:** U.S. Census Bureau American Community Survey (ACS) 5-Year Estimates (2019-2023).

**API endpoint:**
```
https://api.census.gov/data/2023/acs/acs5
  ?get=B01003_001E,NAME
  &for=tract:*
  &in=state:06+county:001,013,041,043,075,081,085
```

`B01003_001E` is total population. No API key is required for small queries; however, a free Census API key is recommended for reliability (register at https://api.census.gov/data/key_signup.html).

**Response format:** Array of arrays. First row is headers `["B01003_001E","NAME","state","county","tract"]`. Subsequent rows contain data. Reconstruct GEOID as `state + county + tract` (e.g., `06` + `001` + `400100` = `06001400100`).

**Population data needed for all area types:**

| Area Type | Population Source | Join Key |
|-----------|-------------------|----------|
| Census Tracts (20 cities) | ACS per-tract data | GEOID |
| SF Neighborhoods | Sum of tract populations whose centroids fall within neighborhood polygon | Spatial join |
| Oakland Beats | Sum of tract populations whose centroids fall within beat polygon | Spatial join |
| Cities (22 BART cities) | Sum of all tract populations within city boundary | Spatial aggregation |

**Storage:** Populate the existing `population` column on `geo_areas` table (already present in schema at `db/schema.sql:116`).

### 3c. Unified GeoJSON

**Build script:** `scripts/build-safety-geojson.ts` (new file)

This script merges all boundary files into a single `public/unified-safety.geojson`:

**Input files:**
1. `public/sf-neighborhoods.geojson` — 41 features
2. `public/oakland-beats.geojson` — 59 features (note: some beats may have no crime data; include all for boundary completeness)
3. Census tract GeoJSON (fetched by `scripts/fetch-census-tracts.ts`) — ~350-500 features

**Processing:**
1. Load SF neighborhoods. Set `areaType: "neighborhood"`, `parentCity: "San Francisco"`. Derive `areaId` as `neighborhood:<SLUG>` matching existing `geo_areas.id` format.
2. Load Oakland beats. Set `areaType: "beat"`, `parentCity: "Oakland"`. Derive `areaId` as `beat:<SLUG>`.
3. Load census tracts. For each tract, determine the parent city via point-in-polygon (tract centroid vs city boundaries). Set `areaType: "tract"`, `parentCity: "<city name>"`. Derive `areaId` as `tract:<GEOID>`.
4. **Exclude SF and Oakland** from the census tract set (they are already covered by neighborhoods/beats).
5. Exclude tracts whose centroid does not fall within any of the 20 target cities.

**Output feature properties:**
```typescript
{
  areaId: string;        // e.g., "neighborhood:mission", "beat:12x", "tract:06001400100"
  areaName: string;      // e.g., "Mission", "12X", "Census Tract 4001"
  areaType: "neighborhood" | "beat" | "tract";
  parentCity: string;    // e.g., "San Francisco", "Oakland", "San Leandro"
  population: number;    // from ACS data
}
```

**Expected output:**
- ~41 SF neighborhoods + ~59 Oakland beats + ~350-500 census tracts = **~450-600 total features**
- Estimated file size: **2-4 MB** (comparable to existing `bay-area-cities.geojson` at 1.2 MB, with more features but smaller individual polygons)

**The existing three GeoJSON files** (`bay-area-cities.geojson`, `sf-neighborhoods.geojson`, `oakland-beats.geojson`) are **retained** as source files but are **no longer loaded by the frontend** — only `unified-safety.geojson` is loaded.

---

## 4. Scoring Algorithm Changes

### 4a. Per-Capita Rate

**Formula:**

```
per_capita_rate = (incident_count / population) * 10_000
```

This produces "incidents per 10,000 residents," a standard criminology metric.

**Per-category rates:**
```typescript
{
  violentRate: (violent_count / population) * 10_000,
  propertyRate: (property_count / population) * 10_000,
  vehicleRate: (vehicle_count / population) * 10_000,
  qualityOfLifeRate: (quality_of_life_count / population) * 10_000,
}
```

**Weighted score calculation** (replaces raw-count weighting):
```typescript
weighted = violentRate * weights.violent
         + propertyRate * weights.property
         + vehicleRate * weights.vehicle
         + qualityOfLifeRate * weights.qualityOfLife;
```

**Edge cases:**

| Case | Population | Handling |
|------|-----------|----------|
| Normal area | > 100 | Use formula directly |
| Very small population | 1-100 | Cap per-capita rate at 99th percentile to prevent outliers (e.g., an industrial tract with 5 residents and 10 crimes would get 20,000 per 10K — cap it) |
| Zero population | 0 | Assign score 5.0 (neutral). Display "Insufficient data" in the detail panel. Examples: Golden Gate Park tract, industrial zones, airport tracts |
| Missing population | null | Same as zero — score 5.0, neutral display |

**Implementation in `lib/safety-scoring.ts`:** The existing `computeSafetyScores` function already supports population-based per-capita scoring (lines 28-47). The change is ensuring population data is always populated in the `AreaCrimeCounts` passed to this function.

### 4b. Score Normalization

**Current formula** (unchanged):
```
score = 10 - (weighted / maxWeighted) * 9
```
Clamped to [1, 10]. Higher score = safer. `maxWeighted` is the maximum weighted value across all areas.

**Impact of per-capita scoring on normalization:**
- The "worst" area shifts from the one with the most raw incidents (likely SF or Oakland, by volume) to the one with the highest per-capita rate (likely a smaller city or neighborhood with high crime density relative to population).
- Score distribution becomes more meaningful: a score of 7 genuinely means "30% of the way from worst to best on a per-capita basis."

**The 20 "downcast" cities:**
- All census tracts within a single city receive the **same** per-capita rate because we only have city-level crime data from CA DOJ.
- Formula: `city_crime_count / city_population * 10_000` applied uniformly to all tracts in that city.
- This means all tracts in, e.g., San Leandro will show the same color — that's expected and correct given the data granularity. The tracts provide visual boundary detail, not data granularity.

**Client-side recomputation:** The `setSafetyWeights` and `setSafetyPreset` actions in `lib/store.ts` (lines 219-269) currently recompute scores from raw counts. These must be updated to use per-capita rates. The API response will include `population` and per-capita rates so the client can recompute with custom weights without re-fetching.

---

## 5. API Changes

### `/api/safety` (GET)

**Current response shape** (unchanged fields omitted):
```typescript
{
  areas: Array<{
    id: string;            // "city:san_francisco", "neighborhood:mission", "beat:12x"
    name: string;
    type: string;          // "city" | "neighborhood" | "beat" | "county"
    parentId: string | null;
    score: number;
    percentileRank: number;
    counts: { violent, property, vehicle, qualityOfLife };
    sources: string[];
    centroidLat: number;
    centroidLng: number;
  }>;
  weights: SafetyWeights;
  lastUpdated: string;
}
```

**New/modified fields per area:**
```typescript
{
  // ... existing fields ...
  population: number | null;         // NEW: from geo_areas.population
  perCapitaRate: number | null;      // NEW: total incidents / population * 10,000
  dataGranularity: "direct" | "inherited";  // NEW: "direct" for SF/Oakland, "inherited" for downcast tracts
}
```

**New area type: `tract`:**
- `id` format: `tract:06001400100` (GEOID)
- `type`: `"tract"`
- `parentId`: `"city:san_leandro"` (parent city geo_area_id)
- `score`: inherited from parent city score (computed with per-capita normalization)
- `counts`: inherited from parent city (city-level counts divided evenly is misleading — instead, store the city-level totals and note `dataGranularity: "inherited"`)
- `sources`: inherited from parent city
- `population`: tract-specific population from ACS

**Tract score computation:**
For the 20 downcast cities, each tract gets the same score as its parent city. The per-capita rate is calculated at the city level: `city_total_incidents / city_total_population * 10_000`. All tracts within that city share this rate and therefore this score.

**Granularity query param:** The existing `?granularity=` filter must accept `"tract"` as a valid value. Add `"tract"` to the `validGranularities` array in `app/api/safety/route.ts:13`.

**Performance:** The response grows from ~129 areas to ~450-600 areas. Each area object is ~200 bytes JSON. Total response size: ~90-120 KB (up from ~25 KB). This is well within acceptable limits. The 1-hour cache (`Cache-Control: public, max-age=3600`) remains appropriate.

### `/api/safety/heatmap` (GET)

**Remove this endpoint.** The heatmap layer is removed from scope. Delete `app/api/safety/heatmap/route.ts`.

---

## 6. Frontend Changes

### 6a. SafetyOverlay.tsx

**Complete rewrite.** Replace the current 441-line component with a simpler implementation:

**Data loading:**
- Load a single GeoJSON file: `fetch('/unified-safety.geojson')`
- Match features to `safetyAreas` by `areaId` property to inject `score` values

**Single Source + Layer set:**
```tsx
<Source id="safety-unified" type="geojson" data={enrichedGeoJSON}>
  {/* Fill layer — constant opacity, score-driven color */}
  <Layer id="safety-fill" type="fill" paint={{
    'fill-color': SCORE_FILL_COLOR,       // same interpolation expression as today
    'fill-opacity': 0.3,                  // CONSTANT — no zoom interpolation
  }} />

  {/* Stroke layer — width varies by zoom for readability */}
  <Layer id="safety-stroke" type="line" paint={{
    'line-color': SCORE_LINE_COLOR,
    'line-width': ['interpolate', ['linear'], ['zoom'],
      8, 0.5,
      12, 1.5,
      16, 2.5,
    ],
    'line-opacity': 0.8,
  }} />

  {/* Labels — visible at higher zoom only */}
  <Layer id="safety-labels" type="symbol" layout={{
    'text-field': ['get', 'areaName'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12],
    'text-anchor': 'center',
    'text-allow-overlap': false,
    'text-font': ['Noto Sans Regular'],
  }} paint={{
    'text-color': '#1f2937',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.5,
    'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 1],
  }} />
</Source>
```

**No-data features** (features in the GeoJSON that don't match any `safetyArea`):
```tsx
<Source id="safety-nodata" type="geojson" data={noDataGeoJSON}>
  <Layer id="safety-nodata-fill" type="fill" paint={{
    'fill-color': '#e5e7eb',
    'fill-opacity': 0.15,
  }} />
  <Layer id="safety-nodata-stroke" type="line" paint={{
    'line-color': '#9ca3af',
    'line-width': 1,
    'line-opacity': 0.5,
  }} />
</Source>
```

**Removed:**
- All city-level sources/layers (`safety-city`, `safety-city-nodata`)
- All detail-level sources/layers (`safety-detail`, `safety-detail-nodata`)
- Heatmap source/layer (`safety-heatmap`)
- Zoom-based opacity interpolation on fill layers
- The `enrichCityFeaturesFromCitySafety` fallback function
- `heatmapData` state and its fetch call to `/api/safety/heatmap`
- The `cityBoundaries`, `sfNeighborhoods`, `oaklandBeats` state variables and their individual fetch calls

**Enrichment function** (simplified):
```typescript
function enrichFeatures(
  geojson: GeoJSON.FeatureCollection,
  areaLookup: Map<string, SafetyArea>
): { withData: GeoJSON.FeatureCollection; noData: GeoJSON.FeatureCollection }
```

Takes the unified GeoJSON and the full `safetyAreas` list. Matches by `feature.properties.areaId` directly (no name-matching heuristic needed since `areaId` is baked into the unified GeoJSON).

### 6b. Detail Panel (SafetyDetailPanel.tsx)

**New behavior for census tract areas:**

When the user clicks a census tract in a downcast city:
- Show the **city name** as the header (e.g., "San Leandro")
- Show the **tract name** as a subtitle (e.g., "Census Tract 4001")
- Show the type badge as `tract` with a distinct color: `bg-amber-100 text-amber-700`
- Show the city-level score, counts, and per-capita rate
- Add an info banner below the score: `"City-level data — neighborhood detail not available for this city"`
- **Omit the trend sparkline** (trend data is per geo_area_id; tracts won't have trend data since crime_observations are city-level)

**When clicking a SF neighborhood or Oakland beat:** Display as today, plus show per-capita rate next to raw incident counts.

**New field display:**
- Add "per 10K residents" label next to per-capita rates in the category breakdown
- Show population in the detail panel: `"Pop. 12,345"`

### 6c. Map.tsx Click Handler Changes

Update the interactive layer IDs in `app/components/Map.tsx`:

**Current** (line 256-258):
```typescript
const interactiveLayerIds = ['stations-layer', 'clusters', 'apartment-points',
                             'safety-city-fill', 'safety-detail-fill'];
```

**New:**
```typescript
const interactiveLayerIds = ['stations-layer', 'clusters', 'apartment-points',
                             'safety-fill'];
```

Update the `queryRenderedFeatures` call (line 236-237):
```typescript
const safetyFeatures = mapRef.current?.queryRenderedFeatures(e.point, {
  layers: ['safety-fill'],
});
```

### 6d. Filter Sidebar

The safety score filter (`minSafetyScore` in `lib/store.ts`) works the same — it filters apartments by the nearest station's safety score. No changes needed. Per-capita scores replace raw-count scores transparently.

### 6e. Zustand Store Changes (`lib/store.ts`)

**`setSafetyWeights` and `setSafetyPreset` actions** (lines 219-269):

Currently recompute scores using raw counts:
```typescript
const w = area.counts.violent * weights.violent + ...
```

Must change to use per-capita rates:
```typescript
const pop = area.population || 0;
const rate = pop > 0 ? {
  violent: (area.counts.violent / pop) * 10000,
  property: (area.counts.property / pop) * 10000,
  vehicle: (area.counts.vehicle / pop) * 10000,
  qualityOfLife: (area.counts.qualityOfLife / pop) * 10000,
} : { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 };
const w = rate.violent * weights.violent + ...
```

**`SafetyArea` type** (`lib/types.ts`):

Add new fields:
```typescript
export interface SafetyArea {
  // ... existing fields ...
  population: number | null;              // NEW
  perCapitaRate: number | null;           // NEW
  dataGranularity: 'direct' | 'inherited'; // NEW
}
```

---

## 7. Database Schema Changes

### 7a. `geo_areas` Table

The `population` column already exists (`db/schema.sql:116`). No schema migration needed for this column.

**Add tract-level records.** The `scripts/fetch-census-tracts.ts` script will insert rows like:
```sql
INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population)
VALUES ('tract:06001400100', 'Census Tract 4001', 'tract', 'city:san_leandro', 37.7125, -122.1569, 4523);
```

**Populate population for existing areas:**
- SF neighborhoods: `UPDATE geo_areas SET population = ? WHERE id = 'neighborhood:mission'`
- Oakland beats: `UPDATE geo_areas SET population = ? WHERE id = 'beat:12x'`
- Cities: `UPDATE geo_areas SET population = ? WHERE id = 'city:san_leandro'`

### 7b. `safety_scores` Table

**Tract records inherit city scores.** For each tract in a downcast city:
```sql
INSERT INTO safety_scores (geo_area_id, score, violent_count, property_count, vehicle_count, quality_of_life_count, total_incidents, sources_used, percentile_rank, computed_at)
SELECT 'tract:06001400100', score, violent_count, property_count, vehicle_count, quality_of_life_count, total_incidents, sources_used, percentile_rank, computed_at
FROM safety_scores WHERE geo_area_id = 'city:san_leandro';
```

This is done programmatically in the orchestrator after computing city scores, not as a one-time migration.

### 7c. Schema Migration

**New migration file:** `db/migrations/003_add_tract_support.sql`

```sql
-- Allow 'tract' as an area_type value (no enum in SQLite, this is documentation)
-- Add index for efficient parent lookups during tract score inheritance
CREATE INDEX IF NOT EXISTS idx_geo_areas_parent_type ON geo_areas(parent_area_id, area_type);
```

No column additions required — the existing schema already has `population`, `parent_area_id`, and flexible `area_type` TEXT.

---

## 8. Data Pipeline Changes

### 8a. New Script: `scripts/fetch-census-tracts.ts`

**Purpose:** Download Census Tract boundaries and ACS population data for the 7 Bay Area counties. Filter tracts to the 20 target cities. Write tract GeoJSON and populate `geo_areas` with tract records and population data.

**Steps:**
1. Fetch tract boundaries from TIGERweb REST API (one query per county, 7 total).
2. Fetch ACS population data from Census API (one query covering all 7 counties).
3. Load `public/bay-area-cities.geojson` for city boundary polygons.
4. For each tract, compute centroid and determine parent city via point-in-polygon test against city boundaries.
5. Filter: keep only tracts whose centroid falls within one of the 20 target cities.
6. Exclude tracts with `AREALAND === 0`.
7. Write filtered tract GeoJSON to `public/census-tracts.geojson`.
8. Upsert tract records into `geo_areas` table with population, parent_area_id, centroid.
9. Also update population for existing SF neighborhood and Oakland beat geo_areas by spatial aggregation of tract populations.
10. Also update population for existing city-level geo_areas by summing tract populations.

**Package.json script:**
```json
"fetch:tracts": "tsx scripts/fetch-census-tracts.ts"
```

**Dependencies:** `@turf/helpers`, `@turf/boolean-point-in-polygon`, `@turf/centroid` (turf is already a dependency for `fetch-city-boundaries.ts`).

**Run cadence:** One-time setup, then annually when Census releases new ACS data. Not part of daily cron.

### 8b. New Script: `scripts/build-safety-geojson.ts`

**Purpose:** Merge SF neighborhoods, Oakland beats, and census tracts into a single `public/unified-safety.geojson`.

**Steps:**
1. Load `public/sf-neighborhoods.geojson`, `public/oakland-beats.geojson`, `public/census-tracts.geojson`.
2. For each SF neighborhood feature, set properties: `areaId: "neighborhood:<SLUG>"`, `areaName: NAME`, `areaType: "neighborhood"`, `parentCity: "San Francisco"`.
3. For each Oakland beat feature, set properties: `areaId: "beat:<SLUG>"`, `areaName: NAME`, `areaType: "beat"`, `parentCity: "Oakland"`.
4. For each census tract feature, set properties: `areaId: "tract:<GEOID>"`, `areaName: NAME`, `areaType: "tract"`, `parentCity: <determined by fetch-census-tracts>`.
5. Query `geo_areas` for population data, inject `population` into each feature's properties.
6. Concatenate all features into a single FeatureCollection.
7. Write to `public/unified-safety.geojson`.

**Package.json script:**
```json
"build:safety-geojson": "tsx scripts/build-safety-geojson.ts"
```

**Run cadence:** After `fetch:tracts` and after any boundary file update. Not part of daily cron.

### 8c. Modified: `scripts/ingest/orchestrator.ts`

**Changes:**

1. **Population loading** (already partially implemented at lines 99-106): Ensure all geo_areas have population data loaded, including tracts.

2. **Tract score inheritance** (new step after Step 5, "Computing safety scores"):
   ```typescript
   // Step 5b: Inherit city scores to census tracts
   const tractAreas = await db.execute(
     `SELECT id, parent_area_id FROM geo_areas WHERE area_type = 'tract'`
   );
   for (const tract of tractAreas.rows) {
     const parentId = tract.parent_area_id as string;
     const parentScore = scores.get(parentId);
     if (parentScore) {
       scores.set(tract.id as string, parentScore);
       areaCountsMap.set(tract.id as string, areaCountsMap.get(parentId)!);
     }
   }
   ```

3. **No changes to individual ingesters** (`datasf.ts`, `oakland.ts`, `ca-doj.ts`). They continue producing observations at their native granularity.

### 8d. Pipeline Execution Order

```
1. npm run fetch:tracts          # One-time: download boundaries + population
2. npm run build:safety-geojson  # One-time: merge into unified GeoJSON
3. npm run ingest:crime:v2       # Daily cron: fetch crime data + compute scores (now with tract inheritance)
```

---

## 9. Visual Spec

### Zoom-Level Behavior

| Zoom | What's Visible | Labels | Stroke Width | Fill Opacity | Notes |
|------|---------------|--------|-------------|-------------|-------|
| 8-9 | All ~450-600 polygons as a Bay Area patchwork | Hidden | 0.5px | 0.3 | Overview of entire BART service area |
| 10 | All polygons, individual neighborhoods start becoming distinguishable | Hidden | 0.75px | 0.3 | User can see rough city shapes |
| 11 | All polygons, labels begin fading in | Fading in (opacity 0->1) | 1.0px | 0.3 | Transition to detail reading |
| 12-13 | All polygons clearly visible with labels | Fully visible | 1.5px | 0.3 | Primary browsing zoom |
| 14+ | Individual tract/neighborhood polygons dominate view | Visible, size 12px | 2.0-2.5px | 0.3 | Street-level detail |

### Per-City Behavior Examples

| Area | Zoom 9 | Zoom 12 | Zoom 14 |
|------|--------|---------|---------|
| **San Francisco** | 41 colored neighborhood polygons (small at this zoom) | Neighborhoods clearly visible with labels and distinct colors | Individual neighborhoods fill the view |
| **Oakland** | 59 colored beat polygons (small) | Beats visible with labels and distinct colors | Individual beats fill the view |
| **San Leandro** | ~15-20 tract polygons, all same color (single city-level score) | Tracts visible with tract number labels, uniform color | Individual tracts, still same color, label reads "Census Tract XXXX" |
| **Bay Overview** | Seamless patchwork of all polygons — no gaps, no color changes, no fading | Same colors as zoom 9, just more detail visible | N/A (too zoomed in for overview) |

### Color Scale (unchanged)

| Score | Color | Hex |
|-------|-------|-----|
| 1 (worst) | Red | #dc2626 |
| 3 | Orange | #f97316 |
| 5 | Yellow | #eab308 |
| 7 | Light Blue | #60a5fa |
| 9 (best) | Blue | #2563eb |

Interpolated linearly between stops.

---

## 10. Edge Cases & Error Handling

### Census Tract with 0 Population

**Scenario:** Tracts covering parks, industrial zones, airports, or water areas may have 0 or null population in ACS data.

**Handling:**
- `geo_areas.population` = 0 or null
- `safety_scores.score` = 5.0 (neutral)
- GeoJSON feature is included with `score: 5` (renders as yellow)
- Detail panel shows: "No population data — score is neutral estimate"

### City with No BART Stations

**Scenario:** Some Bay Area cities in the GeoJSON (e.g., Sausalito, Palo Alto) have no BART stations and are not in `STATION_CITY`.

**Handling:** These cities are **not** included in the 20 target cities list. Census tracts are only fetched for the 20 cities that have BART stations. Other cities' polygons from `bay-area-cities.geojson` are no longer rendered (since the frontend only loads `unified-safety.geojson`).

### Unified GeoJSON Loading Failure

**Scenario:** Network error or corrupted file prevents `unified-safety.geojson` from loading.

**Handling:**
- `SafetyOverlay` returns `null` (no overlay rendered)
- The Safety toggle button still works (state is managed by Zustand, not the GeoJSON)
- Console warning: `"Failed to load unified-safety.geojson"`
- No user-visible error banner (the overlay is optional — user can still use the map)

### Census Data Update Cadence

**Scenario:** ACS data is released annually (typically September). Tract boundaries change with each decennial census (2020, 2030).

**Handling:**
- Run `npm run fetch:tracts` annually after new ACS release
- Run `npm run build:safety-geojson` after tract update
- Boundaries are stable within a decade; only population numbers change year-to-year

### Tract Centroid Falls in No City

**Scenario:** Some tracts at city borders may have centroids in unincorporated areas.

**Handling:** Discard these tracts. They are not part of any BART city and would have no crime data to inherit.

### Overlapping Polygons

**Scenario:** A tract polygon might partially overlap with an SF neighborhood or Oakland beat polygon.

**Handling:** The build script explicitly excludes SF and Oakland from the census tract set. There should be no overlap. If minor boundary mismatches exist at edges, MapLibre's z-ordering renders the last feature in the GeoJSON on top — neighborhoods/beats are placed after tracts in the FeatureCollection to take visual priority.

---

## 11. Acceptance Criteria

1. **AC-1:** At zoom level 9, every pixel within the 22 BART city boundaries is covered by a colored polygon (no gaps, no blank areas). Verify by visual inspection with safety overlay ON.

2. **AC-2:** Zooming from level 9 to level 14 on any point in San Francisco produces no color change for that area's polygon. Same for Oakland and San Leandro.

3. **AC-3:** Zooming into San Leandro at zoom 14 shows census tract boundaries (polygon edges visible), and all tracts within San Leandro are the same color (since they inherit the same city-level score).

4. **AC-4:** The `/api/safety` response includes `population`, `perCapitaRate`, and `dataGranularity` fields for every area. Tract areas have `type: "tract"` and `dataGranularity: "inherited"`.

5. **AC-5:** Clicking a census tract in San Jose opens the detail panel showing the city name "San Jose", tract name as subtitle, and the info banner "City-level data — neighborhood detail not available for this city".

6. **AC-6:** Clicking a SF neighborhood (e.g., Mission) opens the detail panel showing per-capita rate alongside raw incident counts.

7. **AC-7:** Changing the safety preset from "Balanced" to "Personal Safety" recalculates scores using per-capita rates. SF Mission (high population) should score relatively better compared to raw counts, while a small-population area with the same raw crime count should score worse.

8. **AC-8:** The `geo_areas` table contains population data for all SF neighborhoods, Oakland beats, census tracts, and cities. Verify: `SELECT count(*) FROM geo_areas WHERE population IS NOT NULL AND population > 0` returns > 400.

9. **AC-9:** The unified GeoJSON file (`public/unified-safety.geojson`) contains 400-600 features. No feature has a null `areaId`. Every `areaId` in the GeoJSON matches a record in the `geo_areas` table.

10. **AC-10:** The heatmap layer and `/api/safety/heatmap` endpoint are removed. No network request to `/api/safety/heatmap` is made by the frontend.

---

## 12. Migration Plan

### Deployment Strategy: Incremental

This can be deployed incrementally in 3 sub-phases:

**Sub-phase A1: Data foundation (backend only, no frontend changes)**
1. Create and run `scripts/fetch-census-tracts.ts` — populates `geo_areas` with tract records and population data.
2. Update `scripts/ingest/orchestrator.ts` to add tract score inheritance step.
3. Run `npm run ingest:crime:v2` to populate `safety_scores` for tracts.
4. Deploy updated `/api/safety` route with new fields (`population`, `perCapitaRate`, `dataGranularity`, `tract` type).
5. **Test:** Verify API returns tract data. Frontend still works unchanged (it ignores unknown fields).

**Sub-phase A2: Build unified GeoJSON**
1. Create and run `scripts/build-safety-geojson.ts`.
2. Commit `public/unified-safety.geojson` to the repo (or generate at build time).
3. **Test:** Verify file is valid GeoJSON with expected feature count.

**Sub-phase A3: Frontend rewrite**
1. Rewrite `SafetyOverlay.tsx` to use single unified source.
2. Update `Map.tsx` interactive layers.
3. Update `SafetyDetailPanel.tsx` for tract display.
4. Update `lib/store.ts` for per-capita recomputation.
5. Update `lib/types.ts` with new SafetyArea fields.
6. Remove `/api/safety/heatmap` route and heatmap references.
7. **Test:** Full visual regression testing.

### Backward Compatibility

- The `/api/safety` response is **additive** (new fields, new area type). Existing consumers are not broken.
- The old GeoJSON files are retained in `public/` but no longer referenced by the frontend.
- The `citySafety` store property and its usage can be removed after confirming no other code depends on it.
- The `crime_stats` legacy table backfill (orchestrator lines 160-217) continues working unchanged.

### Rollback

If issues arise after deployment:
- Frontend: Revert the `SafetyOverlay.tsx` and `Map.tsx` changes to restore the two-layer crossfade.
- Backend: The tract data in `geo_areas` and `safety_scores` is harmless — it's just additional rows that the old frontend ignores.

---

## 13. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `scripts/fetch-census-tracts.ts` | **Create** | Download Census Tract boundaries + ACS population, populate geo_areas |
| `scripts/build-safety-geojson.ts` | **Create** | Merge SF neighborhoods + Oakland beats + census tracts into unified GeoJSON |
| `public/unified-safety.geojson` | **Create** | Single merged GeoJSON loaded by frontend (~2-4 MB) |
| `public/census-tracts.geojson` | **Create** | Intermediate file: filtered census tract boundaries for 20 cities |
| `db/migrations/003_add_tract_support.sql` | **Create** | Add composite index on geo_areas(parent_area_id, area_type) |
| `app/components/SafetyOverlay.tsx` | **Rewrite** | Single source/layer, no crossfade, no heatmap, ~150 lines (down from 441) |
| `app/components/SafetyDetailPanel.tsx` | **Modify** | Add tract display, per-capita rates, info banner for inherited data |
| `app/components/Map.tsx` | **Modify** | Update interactive layer IDs (lines 236-237, 256-258) |
| `app/api/safety/route.ts` | **Modify** | Add population, perCapitaRate, dataGranularity fields; accept `tract` granularity |
| `app/api/safety/heatmap/route.ts` | **Delete** | Heatmap endpoint removed from scope |
| `lib/safety-scoring.ts` | **Modify** | Ensure per-capita path handles edge cases (0 pop, cap outliers) |
| `lib/types.ts` | **Modify** | Add `population`, `perCapitaRate`, `dataGranularity` to SafetyArea |
| `lib/store.ts` | **Modify** | Update `setSafetyWeights`/`setSafetyPreset` to use per-capita rates for recomputation |
| `lib/crime-taxonomy.ts` | **No change** | Categories and weights unchanged |
| `scripts/ingest/orchestrator.ts` | **Modify** | Add Step 5b: tract score inheritance after city score computation |
| `scripts/ingest/ca-doj.ts` | **No change** | Continues producing city-level observations |
| `scripts/ingest/datasf.ts` | **No change** | Continues producing neighborhood-level observations |
| `scripts/ingest/oakland.ts` | **No change** | Continues producing beat-level observations |
| `package.json` | **Modify** | Add `fetch:tracts` and `build:safety-geojson` scripts |
| `db/schema.sql` | **No change** | Schema already supports population, parent_area_id, flexible area_type |
