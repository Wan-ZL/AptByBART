-- Add composite index for efficient parent lookups during tract score inheritance
CREATE INDEX IF NOT EXISTS idx_geo_areas_parent_type ON geo_areas(parent_area_id, area_type);
