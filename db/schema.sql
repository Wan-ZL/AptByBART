CREATE TABLE IF NOT EXISTS bart_stations (
  id TEXT PRIMARY KEY,                    -- BART abbreviation, e.g., 'MONT', 'EMBR'
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT,
  city TEXT,
  county TEXT,
  line_colors TEXT,                       -- JSON array: ["yellow","blue","red"]
  travel_time_to_montgomery INTEGER,      -- minutes
  fare_to_montgomery INTEGER,             -- in cents to avoid float issues
  monthly_commute_cost INTEGER            -- in cents, fare * 0.9375 * 2 * 22
);

CREATE TABLE IF NOT EXISTS apartments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  website_url TEXT NOT NULL,
  phone TEXT,
  nearest_station_id TEXT REFERENCES bart_stations(id),
  walk_min_to_bart INTEGER,
  has_in_unit_wd INTEGER DEFAULT 0,       -- SQLite boolean (0/1)
  has_dishwasher INTEGER DEFAULT 0,
  has_parking INTEGER DEFAULT 0,
  parking_type TEXT,                       -- 'garage', 'surface', 'street'
  has_gym INTEGER DEFAULT 0,
  has_pool INTEGER DEFAULT 0,
  pet_friendly INTEGER DEFAULT 0,
  year_built INTEGER,
  amenities_json TEXT,                    -- JSON for less-common amenities
  scrape_status TEXT DEFAULT 'pending',   -- 'pending', 'active', 'stale', 'broken'
  last_successful_tier TEXT,              -- 'rentcafe', 'cheerio', 'playwright', 'openai', 'claude'
  last_scraped_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS floor_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  name TEXT,
  bedrooms INTEGER NOT NULL,              -- 0 = studio
  bathrooms REAL NOT NULL,
  sqft_min INTEGER,
  sqft_max INTEGER,
  price_min INTEGER,                      -- monthly rent in dollars
  price_max INTEGER,
  available_units INTEGER DEFAULT 0,
  floor_plan_url TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  floor_plan_id INTEGER NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  price_min INTEGER NOT NULL,
  price_max INTEGER NOT NULL,
  available_units INTEGER,
  recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_history_plan_date ON price_history(floor_plan_id, recorded_at);

CREATE TABLE IF NOT EXISTS crime_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL REFERENCES bart_stations(id),
  data_year INTEGER NOT NULL,
  data_month INTEGER NOT NULL,
  violent_crime_count INTEGER DEFAULT 0,
  property_crime_count INTEGER DEFAULT 0,
  vehicle_crime_count INTEGER DEFAULT 0,
  total_incidents INTEGER DEFAULT 0,
  safety_score REAL,
  source TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(station_id, data_year, data_month)
);

CREATE TABLE IF NOT EXISTS scrape_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id INTEGER REFERENCES apartments(id),
  status TEXT NOT NULL,                   -- 'success', 'error', 'timeout', 'captcha'
  duration_ms INTEGER,
  error_message TEXT,
  pages_scraped INTEGER,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_apartment ON scrape_logs(apartment_id, started_at);

-- Crime data sources registry
CREATE TABLE IF NOT EXISTS crime_data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_type TEXT NOT NULL,
  base_url TEXT,
  granularity TEXT NOT NULL,
  update_frequency TEXT,
  last_fetched_at TEXT,
  last_success_at TEXT,
  record_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

-- Geographic areas at multiple granularity levels
CREATE TABLE IF NOT EXISTS geo_areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area_type TEXT NOT NULL,
  parent_area_id TEXT,
  centroid_lat REAL,
  centroid_lng REAL,
  population INTEGER,
  FOREIGN KEY (parent_area_id) REFERENCES geo_areas(id)
);
CREATE INDEX IF NOT EXISTS idx_geo_areas_type ON geo_areas(area_type);
CREATE INDEX IF NOT EXISTS idx_geo_areas_parent ON geo_areas(parent_area_id);
CREATE INDEX IF NOT EXISTS idx_geo_areas_parent_type ON geo_areas(parent_area_id, area_type);

-- Raw crime observations from any source
CREATE TABLE IF NOT EXISTS crime_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES crime_data_sources(id),
  geo_area_id TEXT NOT NULL REFERENCES geo_areas(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  category TEXT NOT NULL,
  incident_count INTEGER NOT NULL DEFAULT 0,
  raw_category TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_id, geo_area_id, period_start, period_end, category)
);
CREATE INDEX IF NOT EXISTS idx_crime_obs_area ON crime_observations(geo_area_id, period_start);
CREATE INDEX IF NOT EXISTS idx_crime_obs_source ON crime_observations(source_id, fetched_at);

-- Computed safety scores per geo area
CREATE TABLE IF NOT EXISTS safety_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  geo_area_id TEXT NOT NULL REFERENCES geo_areas(id),
  score REAL NOT NULL,
  violent_count INTEGER DEFAULT 0,
  property_count INTEGER DEFAULT 0,
  vehicle_count INTEGER DEFAULT 0,
  quality_of_life_count INTEGER DEFAULT 0,
  total_incidents INTEGER DEFAULT 0,
  sources_used TEXT,
  percentile_rank INTEGER,
  computed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(geo_area_id)
);
CREATE INDEX IF NOT EXISTS idx_safety_scores_area ON safety_scores(geo_area_id);

-- Apartment to geo area mapping (many-to-many)
CREATE TABLE IF NOT EXISTS apartment_geo_areas (
  apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  geo_area_id TEXT NOT NULL REFERENCES geo_areas(id),
  PRIMARY KEY (apartment_id, geo_area_id)
);
CREATE INDEX IF NOT EXISTS idx_apt_geo_area ON apartment_geo_areas(geo_area_id);

-- Station to geo area mapping
CREATE TABLE IF NOT EXISTS station_geo_areas (
  station_id TEXT NOT NULL REFERENCES bart_stations(id),
  geo_area_id TEXT NOT NULL REFERENCES geo_areas(id),
  PRIMARY KEY (station_id, geo_area_id)
);
