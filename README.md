# AptByBART

An interactive web app that combines BART station data, real apartment prices (scraped directly from apartment community websites), and crime/safety data onto a single interactive map. Designed to help Bay Area renters find the most affordable and safest apartments along the BART corridor.

## Key Features

- **Interactive Map** — BART lines and stations overlay, apartment markers with price labels, and a toggleable crime/safety choropleth layer
- **Real Apartment Prices** — Scraped directly from apartment community websites (not aggregator estimates like Zillow/Apartments.com)
- **Safety Scores** — Per-station neighborhood scores combining violent crime, property crime, and vehicle crime data
- **Smart Filters** — Price range, bedrooms, amenities (in-unit W/D, dishwasher, garage parking), max commute time, minimum safety score
- **Pre-computed Commute Data** — Travel times and fares from every BART station to Montgomery St (Financial District)
- **Price History Tracking** — Daily snapshots enable trend analysis, showing whether rents are rising or falling over time

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router, TypeScript) | Full-stack: React frontend + API routes |
| Map | MapLibre GL JS + react-map-gl | Free, WebGL GPU-accelerated, built-in clustering + heatmap |
| Map Tiles | OpenFreeMap / MapTiler free tier | $0/month |
| State Management | Zustand | Simple, performant filter + map state |
| Styling | Tailwind CSS + Radix UI | Rapid development + accessible components |
| Database | SQLite via Turso (free tier) | 5 GB free, no expiry, HTTP access from anywhere |
| Scraping | Crawlee (Node.js) + Playwright | Supports HTTP/Cheerio and headless browser |
| Web Hosting | Render Free tier | Free web service (15-min sleep on inactivity) |
| Scraper Hosting | Render Cron Job (Standard 2 GB) | ~$1.75/mo, covered by $50 Render credit |

## Architecture

```
                          ┌──────────────────┐
                          │  User's Browser  │
                          └────────┬─────────┘
                                   │ HTTPS
                                   ▼
┌──────────────────────────────────────────────────────────┐
│                  Render Free Tier                         │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Next.js 15 (App Router)                │ │
│  │                                                     │ │
│  │  ┌───────────────────┐  ┌────────────────────────┐  │ │
│  │  │    Frontend        │  │    API Routes          │  │ │
│  │  │                    │  │                        │  │ │
│  │  │  React 19          │  │  GET /api/stations     │  │ │
│  │  │  MapLibre GL JS    │  │  GET /api/apartments   │  │ │
│  │  │  Zustand (state)   │  │  GET /api/apartments/:id│ │ │
│  │  │  Tailwind + Radix  │  │  GET /api/crime        │  │ │
│  │  └───────────────────┘  └───────────┬────────────┘  │ │
│  └─────────────────────────────────────┼───────────────┘ │
└────────────────────────────────────────┼─────────────────┘
                                         │ libSQL / HTTP
                                         ▼
                          ┌──────────────────────────────┐
                          │    Turso Database (Free)      │
                          │    SQLite · 5GB · 500M reads  │
                          │                              │
                          │  ┌────────────────────────┐  │
                          │  │ bart_stations       50 │  │
                          │  │ apartments     500-1K  │  │
                          │  │ floor_plans     5000+  │  │
                          │  │ price_history  ~1.5M/y │  │
                          │  │ crime_stats    600/yr  │  │
                          │  │ scrape_logs    per run │  │
                          │  └────────────────────────┘  │
                          └──────────────┬───────────────┘
                                         ▲ libSQL / HTTP
                                         │
┌────────────────────────────────────────────────────────────┐
│          Render Cron Job (Standard 2GB · $1.75/mo)         │
│          Schedule: Daily 2:00 AM PT                        │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Scraper (Crawlee + Playwright)              │  │
│  │                                                      │  │
│  │  TIER 1 ── RentCafe API (HTTP JSON)       ~40-50%   │  │
│  │  TIER 2 ── HTTP + Cheerio (static HTML)   ~20%      │  │
│  │  TIER 3 ── Playwright (JS-rendered)       ~20%      │  │
│  │  TIER 4 ── Claude API (LLM extraction)    ~10%      │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────┬────────────────────────────┬────────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│    External APIs          │  │   Apartment Websites          │
│                          │  │                              │
│  BART API (stations,     │  │  *.rentcafe.com              │
│    travel times, fares)  │  │  *.entrata.com               │
│  Google Places API       │  │  Custom property sites       │
│    (apartment discovery) │  │  (~500 unique domains)       │
│  DataSF Socrata API      │  │                              │
│    (SF crime data)       │  └──────────────────────────────┘
│  Oakland Open Data API   │
│    (Oakland crime data)  │
│  CA DOJ OpenJustice CSV  │
│    (statewide crime)     │
└──────────────────────────┘
```

## Data Pipeline

```
┌─────────────────────┐   ┌──────────────────┐   ┌───────────────────┐   ┌─────────────┐
│  EXTERNAL SOURCES   │   │   INGESTION      │   │   DATABASE        │   │  DELIVERY   │
│                     │   │                  │   │   (Turso/SQLite)  │   │             │
│                     │   │                  │   │                   │   │             │
│ BART GTFS ─────────────→│ seed script ────────→│ bart_stations     │   │             │
│   (one-time)        │   │                  │   │   (50 rows)       │   │             │
│                     │   │                  │   │                   │   │             │
│ Google Places ─────────→│ discovery ───────────→│ apartments        │   │             │
│   (quarterly)       │   │  script          │   │   (500-1000)      │   │             │
│                     │   │                  │   │                   │   │             │
│ ~500 Apt Websites ─────→│ Crawlee scraper ────→│ floor_plans       │   │  API Routes │
│   (daily)           │   │  (T1/T2/T3/T4)  │   │   (5000+)         │──→│  /stations  │
│                     │   │       │          │   │                   │   │  /apartments│
│                     │   │       └──────────────→│ price_history     │   │  /crime     │
│                     │   │                  │   │   (~1.5M/yr)      │   │      │      │
│ DataSF API ────────────→│ crime ingestion ────→│                   │   │      │      │
│   (monthly)         │   │                  │   │ crime_stats       │   │      ▼      │
│                     │   │                  │   │   (600/yr)        │   │  Frontend   │
│ Oakland Open Data ─────→│ crime ingestion ────→│                   │   │  (React +   │
│   (monthly)         │   │                  │   │ scrape_logs       │   │  MapLibre)  │
│                     │   │                  │   │   (per run)       │   │      │      │
│ CA DOJ CSV ────────────→│ crime ingestion ────→│                   │   │      ▼      │
│   (annual)          │   │                  │   │                   │   │   User      │
└─────────────────────┘   └──────────────────┘   └───────────────────┘   └─────────────┘
```

## Scraping Strategy

```
                         Apartment URL
                              │
                              ▼
                    *.rentcafe.com ?
                     │            │
                    YES           NO
                     │            │
                     ▼            ▼
          TIER 1: RentCafe    Static HTML
          API (HTTP JSON)     parseable?
               │               │       │
          ┌────┴────┐         YES      NO
          │         │          │       │
       Success    Fail         ▼       ▼
          │         │    TIER 2: HTTP   JS-rendered
          ▼         │    + Cheerio     content
       Save ✓      │         │              │
                    │    ┌────┴────┐         │
                    │    │         │         │
                    │ Success    Fail        │
                    │    │         │         │
                    │    ▼         │         │
                    │ Save ✓      │         │
                    │             ▼         ▼
                    └──────→ TIER 3: Playwright
                             (headless browser)
                                   │
                              ┌────┴────┐
                              │         │
                           Success    Fail
                              │         │
                              ▼         ▼
                           Save ✓   TIER 4: Claude API
                                    (LLM extraction)
                                         │
                                    ┌────┴────┐
                                    │         │
                                 Success    Fail
                                    │         │
                                    ▼         ▼
                                 Save ✓   Log error
                                          Mark "broken"

  ┌─────────────────────────────────────────────────────────┐
  │  STALENESS RULES                                        │
  │                                                         │
  │  >3 days not scraped ─────────────────→ status: "stale" │
  │  >7 days not scraped ─────────────────→ status: "broken"│
  │  3 consecutive failures ──────────────→ status: "broken"│
  │                                         → manual review │
  └─────────────────────────────────────────────────────────┘
```

## Data Sources

### BART Station Data (50 stations)

| Endpoint | URL |
|----------|-----|
| Station List | `https://api.bart.gov/api/stn.aspx?cmd=stns&key=MW9S-E7SL-26DU-VV8V&json=y` |
| Travel Time | `https://api.bart.gov/api/sched.aspx?cmd=depart&orig={STATION}&dest=MONT&key=MW9S-E7SL-26DU-VV8V&json=y` |
| Fare | `https://api.bart.gov/api/sched.aspx?cmd=fare&orig={STATION}&dest=MONT&key=MW9S-E7SL-26DU-VV8V&json=y` |
| GTFS Feed | `https://www.bart.gov/dev/schedules/google_transit.zip` |

- Public API key (no registration required): `MW9S-E7SL-26DU-VV8V`
- Provides station names, coordinates, and line colors
- Monthly commute cost formula: `fare x 0.9375 (HVD 6.25% discount) x 2 (round trip) x 22 workdays`

### Apartment Data (~500-1000 apartments)

**Discovery:** Google Places API Nearby Search (`places.googleapis.com/v1/places:searchNearby`)
- Types: `apartment_building`, `apartment_complex`, `condominium_complex`
- ~50 requests for 50 stations, within free tier

**Price Scraping (tiered strategy):**

| Tier | Method | Coverage | Notes |
|------|--------|----------|-------|
| T1 | RentCafe API | ~40-50% | Direct HTTP JSON via `api.rentcafe.com/rentcafeapi.aspx` |
| T2 | HTTP + Cheerio | ~20% | Static HTML pages |
| T3 | Playwright | ~20% | JS-rendered sites (Entrata, etc.) |
| T4 | Claude API fallback | ~10% | LLM extraction for unstructured sites |

### Crime / Safety Data

| Area | Source | URL |
|------|--------|-----|
| San Francisco (20 stations) | DataSF Socrata API | `https://data.sfgov.org/resource/wg3w-h783.json` |
| Oakland (8 stations) | Oakland Open Data | `https://data.oaklandca.gov/resource/ym6k-rx7a.json` |
| Other cities (22 stations) | CA DOJ OpenJustice CSV | `https://data-openjustice.doj.ca.gov/sites/default/files/dataset/2024-07/Crimes_and_Clearances_with_Arson-1985-2023.csv` |

#### Crime Data Source Coverage by Station

```
TIER 1: DataSF (incident-level, geocoded, DAILY updates)
┌───────────────────────────────────────────────────────────┐
│  SF Stations:                                             │
│    EMBR  MONT  POWL  CIVC  16TH  24TH                    │
│    GLEN  BALB  DALY                                       │
│                                                           │
│  Vehicle break-in: ✓  (Larceny - From Vehicle)            │
│  Coverage: ~12 stations                                   │
│  Precision: 0.5-mile radius geocoded incidents            │
└───────────────────────────────────────────────────────────┘

TIER 2: Oakland Open Data (incident-level, geocoded, IRREGULAR)
┌───────────────────────────────────────────────────────────┐
│  Oakland Stations:                                        │
│    WOAK  12TH  19TH  LAKE  FTVL  COLS                    │
│    MCAR  ROCK  ASHB  DBRK  NBRK                          │
│                                                           │
│  Vehicle break-in: ✓  (BURG-AUTO)                         │
│  Coverage: ~10 stations                                   │
│  Precision: 0.5-mile radius geocoded incidents            │
└───────────────────────────────────────────────────────────┘

TIER 3: CA DOJ OpenJustice (city-level aggregates, ANNUAL)
┌───────────────────────────────────────────────────────────┐
│  Peninsula:                                               │
│    COLM  SSAN  SBRN  MLBR  SFIA                          │
│  East Bay North:                                          │
│    PLZA  DELN  RICH  ORIN  LAFY  WCRK  PHIL              │
│    CONC  NCON  PITT  PCTR  ANTC                           │
│  East Bay South:                                          │
│    BAYF  SANL  HAYW  SHAY  UCTY  FRMT  WARM              │
│    CAST  DUBL  WDUB                                       │
│  South Bay:                                               │
│    MLPT  BERY                                             │
│  Airport:                                                 │
│    OAKL                                                   │
│                                                           │
│  Vehicle break-in: partial  (VehicleTheft_sum only)       │
│  Coverage: ~28 stations                                   │
│  Precision: city-wide averages (lower granularity)        │
└───────────────────────────────────────────────────────────┘
```

**Safety Score Formula:**

```
safety_score = 10 - (violent × 3 + property × 1 + vehicle × 1.5) / normalizer
```

- Vehicle crime weighted higher (relevant for car owners near BART)
- SF vehicle break-in data filtered by: `incident_subcategory = 'Larceny - From Vehicle'`
- Score range: 1 (least safe) to 10 (safest)

## Database Schema

```
┌────────────────────────┐         ┌──────────────────────────────────┐
│     bart_stations      │         │           apartments             │
├────────────────────────┤         ├──────────────────────────────────┤
│ PK  id            TEXT │───┐     │ PK  id                     TEXT │
│     name          TEXT │   │     │ FK  nearest_station_id     TEXT │──┐
│     abbr          TEXT │   │     │     name                   TEXT │  │
│     lat           REAL │   │     │     address                TEXT │  │
│     lng           REAL │   │     │     lat                    REAL │  │
│     line_colors   TEXT │   │     │     lng                    REAL │  │
│     travel_time   INT  │   │     │     website_url            TEXT │  │
│     fare          REAL │   │     │     walk_min_to_bart       INT  │  │
└────────────────────────┘   │     │     has_in_unit_wd         BOOL │  │
         │                   │     │     has_dishwasher         BOOL │  │
         │  1:N              │     │     has_parking            BOOL │  │
         │                   │     │     parking_type           TEXT │  │
         ▼                   │     │     scrape_status          TEXT │  │
┌────────────────────────┐   │     │     last_scraped_at        TEXT │  │
│     crime_stats        │   │     └──────────────────────────────────┘  │
├────────────────────────┤   │              │              │             │
│ PK  id            TEXT │   │              │ 1:N          │ 1:N         │
│ FK  station_id    TEXT │◀──┘              │              │             │
│     month         TEXT │                  ▼              ▼             │
│     violent_count  INT │   ┌──────────────────────┐  ┌──────────────┐ │
│     property_count INT │   │     floor_plans      │  │ scrape_logs  │ │
│     vehicle_count  INT │   ├──────────────────────┤  ├──────────────┤ │
│     safety_score  REAL │   │ PK  id          TEXT │  │ PK  id  TEXT │ │
└────────────────────────┘   │ FK  apartment_id TEXT │◀─│FK apt_id TEXT│◀┘
                             │     bedrooms     INT │  │    status TEXT│
                             │     bathrooms    INT │  │    duration_ms│
                             │     sqft_min     INT │  │    error  TEXT│
                             │     sqft_max     INT │  │    created_at │
                             │     price_min    INT │  └──────────────┘
                             │     price_max    INT │
                             │     avail_units  INT │
                             └──────────┬───────────┘
                                        │ 1:N
                                        ▼
                             ┌──────────────────────┐
                             │    price_history      │
                             ├──────────────────────┤
                             │ PK  id          TEXT │
                             │ FK  floor_plan_id TEXT│
                             │     date         TEXT │
                             │     price_min     INT │
                             │     price_max     INT │
                             └──────────────────────┘
```

| Table | Rows | Key Columns |
|-------|------|-------------|
| `bart_stations` | 50 | id, name, lat, lng, line_colors, travel_time_to_montgomery, fare_to_montgomery |
| `apartments` | 500-1000 | name, address, lat, lng, website_url, nearest_station_id, walk_min_to_bart, amenity flags (has_in_unit_wd, has_dishwasher, has_parking, parking_type), scrape_status, last_scraped_at |
| `floor_plans` | 3-15 per apartment | bedrooms, bathrooms, sqft_min, sqft_max, price_min, price_max, available_units |
| `price_history` | ~1.5M rows/year | floor_plan_id, date, price_min, price_max (daily snapshots for trend analysis) |
| `crime_stats` | monthly per station | station_id, month, violent_count, property_count, vehicle_count, safety_score |
| `scrape_logs` | per run | apartment_id, status, duration_ms, error_message |

## API Endpoints

### `GET /api/stations`

Returns all BART stations with travel time, fare, and safety score.

### `GET /api/apartments`

Returns apartments within the map viewport, filtered by query params.

| Parameter | Type | Example |
|-----------|------|---------|
| `bbox` | string | `bbox=-122.5,37.5,-122.0,37.9` |
| `bedrooms` | number | `bedrooms=1` |
| `max_price` | number | `max_price=3000` |
| `has_in_unit_wd` | boolean | `has_in_unit_wd=true` |
| `has_dishwasher` | boolean | `has_dishwasher=true` |
| `has_parking` | boolean | `has_parking=true` |
| `max_commute` | number | `max_commute=30` (minutes) |
| `min_safety` | number | `min_safety=6` |

### `GET /api/apartments/:id`

Returns apartment detail with all floor plans and 90-day price history.

### `GET /api/stations/:id/crime`

Returns crime statistics for a station's neighborhood over the last 12 months.

## Frontend UI

### Desktop Layout (>=1024px)

**Desktop:** Left 360px filter sidebar + right full-width map (Zillow-style split view)

```
┌──────────────────────────────────────────────────────────────────────┐
│  AptByBART                                        [Safety ●] [?]   │
├───────────────┬──────────────────────────────────────────────────────┤
│ FILTERS       │                                                      │
│               │         ══╗ BART Yellow Line                         │
│ Price Range   │       ●══╬══●══●                                    │
│ [$1.5K━━$4K]  │          ╚══╗  ↑Montgomery                         │
│               │    [$2,450] ●  │                                    │
│ Bedrooms      │         [$3,100]●                                   │
│ [S][1][2][3+] │              [$2,800]●                              │
│               │                                                      │
│ Amenities     │     [Safety Overlay: green/yellow/red regions]      │
│ ☑ In-unit W/D │                                                      │
│ ☑ Dishwasher  │                                                      │
│ ☑ Garage      │                                                      │
│ ☐ Pool        │                                                      │
│               │                                                      │
│ Commute       │              ● BART Station                         │
│ [10━━━45 min] │              ● Apartment ($price)                   │
│               │                                                      │
│ Safety        │     Legend: ■ Safe  ■ Medium  ■ Caution             │
│ [Min: 5━━10]  │                                     [+][-][◎]      │
│───────────────│──────────────────────────────────────────────────────│
│ 127 apts found│                                                      │
│───────────────│                                                      │
│ ┌───────────┐ │                                                      │
│ │ Atlas OAK │ │                                                      │
│ │ $2,486 1BR│ │                                                      │
│ │ W/D DW P  │ │                                                      │
│ │ ●7.2 MCAR │ │                                                      │
│ └───────────┘ │                                                      │
│ ┌───────────┐ │                                                      │
│ │ Avalon SB │ │                                                      │
│ │ $2,750 1BR│ │                                                      │
│ │ W/D DW P  │ │                                                      │
│ │ ●6.8 SBRN │ │                                                      │
│ └───────────┘ │                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
```

### Mobile Layout (<768px)

**Mobile:** Full-screen map + bottom draggable sheet

```
┌────────────────────────┐
│ AptByBART  [Filter] [≡]│
├────────────────────────┤
│                        │
│     MAP (fullscreen)   │
│   ●━━●━━● BART lines  │
│  [$2,450]● apartments  │
│                        │
├────────────────────────┤
│ ─── drag handle ───    │
│ 127 apartments found   │
│ ┌────────┐ ┌────────┐  │
│ │Atlas   │ │Avalon  │  │
│ │$2,486  │ │$2,750  │  │
│ └────────┘ └────────┘  │
└────────────────────────┘
```

### Apartment Detail Popup

```
┌─────────────────────────────────────┐
│ Atlas Oakland                        │
│ 1234 Broadway, Oakland CA            │
├──────────┬────────┬──────────┬──────┤
│ Type     │ SqFt   │ Price    │Avail │
├──────────┼────────┼──────────┼──────┤
│ Studio   │450-500 │$2,100-2.3K│  3  │
│ 1BR      │650-750 │$2,450-2.8K│  5  │
│ 2BR      │950-1.1K│$3,200-3.6K│  2  │
├──────────┴────────┴──────────┴──────┤
│ [W/D] [DW] [Garage] [Gym]          │
│ Safety: 7.2/10 ●●●●●●●○○○          │
│ BART: MacArthur · 8 min walk        │
│ Trend: ▁▂▃▃▄▅▅▄▃▃  -$150/30d       │
│              [View Website →]        │
└─────────────────────────────────────┘
```

### Map Layers

- **BART Lines** — 6-color polylines: Yellow, Orange, Red, Blue, Green, Beige
- **Station Markers** — With zoom-dependent labels
- **Apartment Markers** — Clustered at low zoom, price pill labels at high zoom (green-to-red gradient by price)
- **Safety Choropleth** — Toggleable semi-transparent colored regions per station neighborhood

### Filter Panel

- Price range slider
- Bedroom selector
- Amenity checkboxes: in-unit W/D, dishwasher, garage parking, pool, gym, pet-friendly
- Max commute time slider (to Montgomery St)
- Min safety score slider
- Scrollable apartment list below filters (hover syncs with map markers)
- URL query params sync for shareable links

## User Interaction Flow

```
FLOW 1: Filter Change (client-side only, <200ms)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User adjusts filter
       │
       ▼
┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────┐
│ Zustand           │───→│ derived             │───→│ UI Updates       │
│ setFilter(key,val)│    │ filteredApartments  │    │                  │
└──────────────────┘    │ (selector recompute)│    │ MapLibre markers │
                        └─────────────────────┘    │ Sidebar list     │
                                                   │ URL query params │
                                                   └──────────────────┘

FLOW 2: Click Apartment Marker
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User clicks marker
       │
       ▼
┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────┐
│ Zustand           │───→│ API Request         │───→│ Turso Query      │
│ selectApartment   │    │ GET /api/apartments │    │                  │
│ (id)              │    │ /:id                │    │ JOIN floor_plans │
└──────────────────┘    └─────────────────────┘    │ JOIN price_hist  │
                                                   └────────┬─────────┘
                                                            │
                                ┌────────────────────────────┘
                                ▼
                   ┌─────────────────────────┐
                   │ Popup: floor plan table  │
                   │ + amenities + safety     │
                   │ + price trend sparkline  │
                   └─────────────────────────┘

FLOW 3: Click BART Station
━━━━━━━━━━━━━━━━━━━━━━━━━━

User clicks station marker
       │
       ▼
┌──────────────────────────────────┐
│ Station Popup                     │
│                                  │
│ Name:         MacArthur          │
│ Lines:        Yellow, Orange     │
│ Travel time:  24 min → MONT     │
│ Fare:         $4.50 one-way     │
│ Monthly cost: $185              │
│ Avg rent:     $2,650 (nearby)   │
│ Safety:       7.8/10            │
└──────────────────────────────────┘

INITIAL PAGE LOAD
━━━━━━━━━━━━━━━━━

Browser ──→ GET /api/stations ────→ Turso ──→ 50 stations
            (cached 24h)                      with lines, fares
       ──→ GET /api/apartments ──→ Turso ──→ apartments in
            ?bbox=... (cached 1h)             viewport bbox
                    │
                    ▼
            ┌───────────────┐     ┌───────────────────┐
            │ Zustand store  │────→│ MapLibre render    │
            │ populate       │     │ all layers:        │
            │ stations[]     │     │  BART lines        │
            │ apartments[]   │     │  station markers   │
            └───────────────┘     │  apt markers       │
                                  │  safety choropleth │
                                  └───────────────────┘
```

## Cost Breakdown

| Service | Provider | Cost |
|---------|----------|------|
| Web Hosting | Render Free tier | $0/mo |
| Scraper | Render Cron Job (Standard 2 GB) | ~$1.75/mo |
| Database | Turso Free tier | $0/mo |
| Map Tiles | OpenFreeMap | $0/mo |
| APIs (BART, Crime, Places) | All free tiers | $0/mo |
| Domain | render.com subdomain or custom | $0-10/year |
| **Total** | | **~$1.75/mo** |

$50 Render credit runway: **~28 months**

## Implementation Phases

| Phase | Timeline | Scope |
|-------|----------|-------|
| Phase 1 | Day 1-2 | Next.js setup, Turso DB, BART station seed script |
| Phase 2 | Day 3-5 | Google Places apartment discovery + RentCafe API scraper |
| Phase 3 | Day 5-7 | Playwright scrapers for Entrata/custom sites |
| Phase 4 | Day 7-9 | Frontend: MapLibre map, BART overlay, apartment markers, filters |
| Phase 5 | Day 9-10 | Crime data ingestion, safety scores, choropleth overlay |
| Phase 6 | Day 10-11 | Daily cron scraper, staleness detection, alerting |
| Phase 7 | Day 11-12 | Mobile responsive, URL sharing, polish, deploy |

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run development server
npm run dev

# Seed BART station data
npm run seed:stations

# Run scraper manually
npm run scrape

# Run tests
npm test
```

## Environment Variables

```
# Turso Database
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# Google Places API (for apartment discovery)
GOOGLE_PLACES_API_KEY=

# Anthropic (for Claude fallback scraping, optional)
ANTHROPIC_API_KEY=
```

## License

MIT
