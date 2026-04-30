# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev              # Next.js dev server on port 4000
npm run build            # Production build
npm run lint             # ESLint
npm run db:migrate       # Run schema migrations (tsx db/migrate.ts)
npm run seed:stations    # Seed BART station data from BART API (one-time)
npm run discover:apartments  # Discover apartments via Google Places API
npm run scrape           # Run 4-tier apartment price scraper
npm run ingest:crime     # Ingest crime data from 3 sources
```

**Local setup:** `npm install` -> `npm run db:migrate` -> `npm run seed:stations` -> `npm run dev`

No `.env.local` needed for basic dev -- db/client.ts falls back to `file:local.db` (local SQLite).

## Architecture

**Split architecture:** The web app and scrapers are separate concerns that share the same database.

- **Web app:** Next.js 15 App Router (React 19) serves frontend + 4 API routes (`/api/stations`, `/api/apartments`, `/api/apartments/:id`, `/api/stations/:id/crime`)
- **Scrapers:** Standalone `tsx` scripts in `scripts/` run via cron (daily 2 AM PT on Render), not part of the web server process
- **Database:** `@libsql/client` connecting to Turso (remote) or local SQLite file. The client in `db/client.ts` auto-falls back to `file:local.db` when `TURSO_DATABASE_URL` is unset
- **Frontend stack:** MapLibre GL JS via `react-map-gl/maplibre`, Zustand for state, Tailwind CSS + Radix UI
- **Path alias:** `@/*` maps to project root (tsconfig paths)

## Data Flow

All data flows: **External APIs -> scripts -> SQLite/Turso DB -> Next.js API routes -> React frontend**

- BART stations: seeded once via `scripts/seed-stations.ts` from BART Legacy API (public key, no registration)
- Apartments: discovered via Google Places (`scripts/discover-apartments.ts`), prices scraped daily by `scripts/scrape.ts`
- Crime data: ingested from DataSF (SF), Oakland Open Data, CA DOJ CSV (`scripts/ingest-crime.ts`)
- Fares stored in **cents** (integers) in `bart_stations.fare_to_montgomery` to avoid float issues
- Floor plan prices stored in **dollars** (integers) in `floor_plans.price_min/price_max`

## Key Patterns

### Scraper Tiers
`scripts/scrape.ts` tries each tier in order, stops on first success:
1. **T1 RentCafe API** (`scrapers/rentcafe.ts`) -- HTTP JSON, ~40-50% coverage
2. **T2 HTTP+Cheerio** (`scrapers/http-cheerio.ts`) -- static HTML parsing, ~20%
3. **T3 Playwright** (`scrapers/playwright-scraper.ts`) -- headless browser, ~20%
4. **T4 Claude API** (`scrapers/claude-fallback.ts`) -- LLM extraction, ~10%

The `ScrapedFloorPlan` interface in `scripts/scrapers/rentcafe.ts` is the shared contract all scrapers return. 3 consecutive failures mark an apartment as `"broken"`.

### Next.js 15 API Routes
Dynamic route params are `Promise`-based in Next.js 15:
```typescript
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
```

### Zustand Store
- `selectFilteredApartments` is a **standalone selector function**, not a store property. Use: `useAppStore(selectFilteredApartments)`
- Filtering is client-side only (<200ms) -- apartments are fetched once on mount, filters recompute via the selector

### Map Component (Map.tsx)
- `MapGL` from `react-map-gl/maplibre` is the root -- `Source`, `Layer`, `SafetyOverlay`, `StationPopup`, `ApartmentPopup` must all render **as children inside MapGL**
- Map is dynamically imported with `ssr: false` in `app/page.tsx` (MapLibre needs the DOM)
- BART line routes are defined as station-ID arrays in `BART_LINES` constant (duplicated in Map.tsx and seed-stations.ts)
- Apartment markers use MapLibre clustering (`clusterMaxZoom: 14`, `clusterRadius: 50`)
- Map tiles from OpenFreeMap (free, no API key)

### Scripts
Scripts manually parse `.env.local` (no dotenv dependency). They import `db` from `../db/client` directly.

## Environment Variables

| Variable | Required For | Notes |
|----------|-------------|-------|
| `TURSO_DATABASE_URL` | Production DB | Optional for local dev (falls back to `file:local.db`) |
| `TURSO_AUTH_TOKEN` | Production DB | Paired with URL above |
| `GOOGLE_PLACES_API_KEY` | `discover:apartments` script | Not needed for web app |
| `ANTHROPIC_API_KEY` | T4 Claude fallback scraper | Optional, scraper skips T4 without it |

## Safety System

**Guiding principle:** Every Bay Area census tract gets a safety score computed from an equal-weight ensemble across all available data sources. Multi-scale coverage doesn't bias any area.

### Safety Data Pipeline

**Step 1 — Ingest & allocate to tract**

All sources (DataSF, Oakland Open Data, CA DOJ, FBI, Santa Clara County, Marin, SJPD, Berkeley, Richmond, Alameda Sheriff, etc.) are allocated to **tract level** regardless of their native granularity:

| Source granularity | Allocation method |
|---|---|
| Already tract-level | Direct |
| Sub-city (beat, neighborhood) | Population-weighted spatial overlap to overlapping tracts |
| City-level (most sources) | `tract_pop / city_pop` × city_crimes |
| County-level | `tract_pop / county_pop` × county_crimes |
| State-level | `tract_pop / state_pop` × state_crimes |

Population data from US Census ACS 5-year (backfilled via `scripts/backfill-population.ts`).

**Step 2 — Empirical-Bayes shrinkage**

For each (source, tract), compute:
```
shrunk_rate = (crimes + α·μ_source) / (population + α)
```
where `α = 1000`, `μ_source` = population-weighted mean rate across all tracts within the source's coverage. This prevents small-population tracts from having volatile rates.

**Step 3 — Per-source normalization (0-1)**

For each source `s`, percentile-rank all tracts within that source's coverage:
```
norm(s, tract) = percentile_rank(shrunk_rate_s_tract, among all tracts that s covers)
```
Scale: **0 = safest, 1 = most dangerous**. A tract not covered by a source contributes nothing to that source's ranking.

**Step 4 — Equal-weight ensemble**

For each tract:
```
final_score(tract) = mean over s covering tract: { norm(s, tract) }
```
- A tract with 1 source → score = that source's rank
- A tract with 10 sources → score = simple average of 10 ranks
- Every source contributes equally; no source is "dropped" or "picked" as authoritative

**Why this works:**
- Data-richness ≠ crime-richness: a tract covered by many sources doesn't look more dangerous just because more sources report it
- Data-sparseness doesn't artificially make a place safer
- Multi-scale blended view is intentional: an Oakland Hills tract gets CA DOJ's "Oakland city rate" (moderate) AND Oakland Open Data's "hills beat rate" (low), averaging to a moderate score that reflects both "lives in Oakland" AND "is in the safer part of Oakland"

### Rendering

- **Single MapLibre layer** — tracts only (1,765 tract polygons across 9 Bay Area counties)
- No beat / neighborhood overlay. Beats and neighborhoods exist in DB for allocation but don't render as separate visual layers
- Color gradient: **0 (safest) → deep blue; 1 (most dangerous) → deep red**, with yellow in middle
- Tract polygons are **clipped to land** — water extensions (bay, ocean) removed via `scripts/clip-tracts-to-land.ts` using turf.difference + bay/ocean polygon

### Population Source

- Census ACS 5-year estimates (2018-2022). 100% coverage on tracts (1,765/1,765). Also covers beats, neighborhoods, cities, counties, state.

### Score Confidence

- Previously shown as separate "Low confidence (allocated)" legend entry + dashed border — **REMOVED** under the equal-weight ensemble model. All tracts computed via the same normalization path.

## Scraper Pipeline

```bash
npm run scrape:pipeline   # Full pipeline: T1→T2→T3→Review→T4→Merge
npm run scrape -- --tier t1  # T1 only (RentCafe API)
npm run scrape -- --tier t2  # T2 only (Cheerio HTML)
npm run scrape -- --tier t3  # T3 only (Crawl4AI)
npm run scrape -- --tier t4  # T4 only (AI+Playwright, reads from t4_pool.json)
npm run scrape -- --fast     # T1+T2 only (skip slow tiers)
```

