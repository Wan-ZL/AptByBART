-- Replace the legacy crime_stats.station_id path for apartment safety scores
-- with a direct spatial FK to the most-granular geo_area containing the apt.
-- Backfilled by scripts/backfill-apartment-geo-areas.ts.

ALTER TABLE apartments ADD COLUMN geo_area_id TEXT REFERENCES geo_areas(id);
CREATE INDEX IF NOT EXISTS idx_apartments_geo_area ON apartments(geo_area_id);
