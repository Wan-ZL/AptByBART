import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'fs';
import { join } from 'path';

let dbCounter = 0;
const testDbFiles: string[] = [];

export async function setupTestDb(): Promise<Client> {
  const dbFile = `test_${process.pid}_${dbCounter++}.db`;
  testDbFiles.push(dbFile);
  const db = createClient({ url: `file:${dbFile}` });

  // Run schema
  const schema = readFileSync(join(__dirname, '../../db/schema.sql'), 'utf-8');
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) await db.execute(stmt);

  // Seed test data
  await db.batch(
    [
      // Stations
      {
        sql: `INSERT INTO bart_stations VALUES ('MONT', 'Montgomery St.', 37.7894, -122.4011, '123 Market', 'San Francisco', 'SF', '["yellow","red","blue","green"]', 0, 0, 0)`,
        args: [],
      },
      {
        sql: `INSERT INTO bart_stations VALUES ('EMBR', 'Embarcadero', 37.7929, -122.3970, '100 The Embarcadero', 'San Francisco', 'SF', '["yellow","red","blue","green"]', 4, 255, 10519)`,
        args: [],
      },
      {
        sql: `INSERT INTO bart_stations VALUES ('WCRK', 'Walnut Creek', 37.9055, -122.0675, '200 Ygnacio', 'Walnut Creek', 'CC', '["yellow"]', 35, 695, 28668)`,
        args: [],
      },
      // Geo areas for apartment spatial safety lookup (new pipeline joins
      // safety_scores via apartments.geo_area_id, not the legacy crime_stats path)
      {
        sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population) VALUES ('tract-sf-1', 'SF Tract 1', 'tract', NULL, 37.79, -122.40, 5000)`,
        args: [],
      },
      {
        sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population) VALUES ('tract-wc-1', 'WC Tract 1', 'tract', NULL, 37.91, -122.07, 3000)`,
        args: [],
      },
      // Safety scores per tract — on 0-1 danger scale (0=safest, 1=most dangerous)
      {
        sql: `INSERT INTO safety_scores (geo_area_id, score, violent_count, property_count, vehicle_count, quality_of_life_count, total_incidents, percentile_rank) VALUES ('tract-sf-1', 6.5, 15, 45, 30, 0, 90, 55)`,
        args: [],
      },
      {
        sql: `INSERT INTO safety_scores (geo_area_id, score, violent_count, property_count, vehicle_count, quality_of_life_count, total_incidents, percentile_rank) VALUES ('tract-wc-1', 8.5, 3, 10, 5, 0, 18, 85)`,
        args: [],
      },
      // Apartments
      {
        sql: `INSERT INTO apartments (id, name, address, lat, lng, website_url, nearest_station_id, walk_min_to_bart, has_in_unit_wd, has_dishwasher, has_parking, parking_type, scrape_status, geo_area_id) VALUES (1, 'Test Apt 1', '100 Main St', 37.79, -122.40, 'https://test1.com', 'EMBR', 5, 1, 1, 1, 'garage', 'active', 'tract-sf-1')`,
        args: [],
      },
      {
        sql: `INSERT INTO apartments (id, name, address, lat, lng, website_url, nearest_station_id, walk_min_to_bart, has_in_unit_wd, has_dishwasher, has_parking, parking_type, scrape_status, geo_area_id) VALUES (2, 'Test Apt 2', '200 Oak St', 37.91, -122.07, 'https://test2.com', 'WCRK', 10, 0, 1, 0, NULL, 'active', 'tract-wc-1')`,
        args: [],
      },
      // Floor plans
      {
        sql: `INSERT INTO floor_plans (id, apartment_id, name, bedrooms, bathrooms, sqft_min, sqft_max, price_min, price_max, available_units) VALUES (1, 1, 'Studio', 0, 1, 400, 450, 2100, 2300, 3)`,
        args: [],
      },
      {
        sql: `INSERT INTO floor_plans (id, apartment_id, name, bedrooms, bathrooms, sqft_min, sqft_max, price_min, price_max, available_units) VALUES (2, 1, '1BR', 1, 1, 650, 700, 2800, 3100, 2)`,
        args: [],
      },
      {
        sql: `INSERT INTO floor_plans (id, apartment_id, name, bedrooms, bathrooms, sqft_min, sqft_max, price_min, price_max, available_units) VALUES (3, 2, '1BR', 1, 1, 700, 750, 2400, 2600, 4)`,
        args: [],
      },
      {
        sql: `INSERT INTO floor_plans (id, apartment_id, name, bedrooms, bathrooms, sqft_min, sqft_max, price_min, price_max, available_units) VALUES (4, 2, '2BR', 2, 2, 1000, 1100, 3200, 3500, 1)`,
        args: [],
      },
      // Crime stats
      {
        sql: `INSERT INTO crime_stats (station_id, data_year, data_month, violent_crime_count, property_crime_count, vehicle_crime_count, total_incidents, safety_score, source) VALUES ('EMBR', 2026, 1, 15, 45, 30, 90, 6.5, 'datasf')`,
        args: [],
      },
      {
        sql: `INSERT INTO crime_stats (station_id, data_year, data_month, violent_crime_count, property_crime_count, vehicle_crime_count, total_incidents, safety_score, source) VALUES ('WCRK', 2026, 1, 3, 10, 5, 18, 8.5, 'cadoj')`,
        args: [],
      },
    ],
    'write'
  );

  return db;
}

export async function cleanupTestDb() {
  const { unlinkSync } = await import('fs');
  for (const f of testDbFiles) {
    try { unlinkSync(f); } catch {}
  }
}
