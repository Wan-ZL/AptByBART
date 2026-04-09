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
