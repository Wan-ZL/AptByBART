import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/client', () => ({
  db: {
    execute: vi.fn(),
    batch: vi.fn(),
  },
}));

vi.mock('next/server', () => {
  return {
    NextResponse: {
      json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
        return {
          status: init?.status ?? 200,
          headers: new Map(Object.entries(init?.headers ?? {})),
          json: async () => body,
        };
      },
    },
    NextRequest: class {
      nextUrl: URL;
      constructor(url: string) {
        this.nextUrl = new URL(url);
      }
    },
  };
});

import { GET } from '@/app/api/apartments/route';
import { db } from '@/db/client';

function makeRequest(params: string = '') {
  // Use the mocked NextRequest
  const { NextRequest } = require('next/server');
  return new NextRequest(`http://localhost:4000/api/apartments${params ? '?' + params : ''}`);
}

describe('GET /api/apartments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when bbox is missing', async () => {
    const request = makeRequest('');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('bbox parameter is required');
  });

  it('returns 400 when bbox has invalid numbers', async () => {
    const request = makeRequest('bbox=a,b,c,d');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('4 valid numbers');
  });

  it('returns apartments with valid bbox including all response fields', async () => {
    const countResult = {
      rows: [{ total: 1 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    const dataResult = {
      rows: [{
        id: 1,
        name: 'Test Apt',
        address: '123 Main',
        lat: 37.8,
        lng: -122.3,
        website_url: 'https://test.com',
        phone: '555-1234',
        nearest_station_id: 'MONT',
        walk_min_to_bart: 5,
        has_in_unit_wd: 1,
        has_dishwasher: 0,
        has_parking: 1,
        parking_type: 'garage',
        has_gym: 1,
        has_pool: 0,
        pet_friendly: 1,
        year_built: 2020,
        scrape_status: 'active',
        min_price: 2500,
        max_price: 3500,
        bedroom_types: '0,1,2',
        station_name: 'Montgomery St.',
        travel_time_to_montgomery: 0,
        fare_to_montgomery: 0,
        safety_score: 8,
      }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(countResult)
      .mockResolvedValueOnce(dataResult);

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.apartments).toHaveLength(1);

    const apt = data.apartments[0];
    expect(apt.name).toBe('Test Apt');
    expect(apt.hasInUnitWd).toBe(true);
    expect(apt.hasDishwasher).toBe(false);
    expect(apt.hasParking).toBe(true);
    expect(apt.petFriendly).toBe(true);
    // New fields from route update
    expect(apt.scrapeStatus).toBe('active');
    expect(apt.maxPrice).toBe(3500);
    expect(apt.bedroomTypes).toEqual([0, 1, 2]);
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
  });

  it('defaults scrapeStatus to pending when null', async () => {
    const countResult = {
      rows: [{ total: 1 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    const dataResult = {
      rows: [{
        id: 1, name: 'No Status', address: '', lat: 37.8, lng: -122.3,
        website_url: '', phone: null, nearest_station_id: null,
        walk_min_to_bart: null, has_in_unit_wd: 0, has_dishwasher: 0,
        has_parking: 0, parking_type: null, has_gym: 0, has_pool: 0,
        pet_friendly: 0, year_built: null, scrape_status: null,
        min_price: null, max_price: null, bedroom_types: null,
        station_name: null, travel_time_to_montgomery: null,
        fare_to_montgomery: null, safety_score: null,
      }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(countResult)
      .mockResolvedValueOnce(dataResult);

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    const data = await response.json();

    const apt = data.apartments[0];
    expect(apt.scrapeStatus).toBe('pending');
    expect(apt.maxPrice).toBeNull();
    expect(apt.bedroomTypes).toEqual([]);
  });

  it('passes bbox args to SQL in correct lat/lng order', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    // bbox format: swLat,swLng,neLat,neLng
    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    await GET(request);

    // Verify the count query SQL args are in correct order
    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    // SQL: a.lat BETWEEN ?[0] AND ?[1], a.lng BETWEEN ?[2] AND ?[3]
    // args[0]=swLat, args[1]=neLat (both are latitude ~37.x)
    // args[2]=swLng, args[3]=neLng (both are longitude ~-122.x)
    expect(countCall.args[0]).toBe(37.7);  // swLat
    expect(countCall.args[1]).toBe(37.9);  // neLat
    expect(countCall.args[2]).toBe(-122.5); // swLng
    expect(countCall.args[3]).toBe(-122.2); // neLng

    // Verify lat args are valid latitudes (between -90 and 90)
    expect(countCall.args[0]).toBeGreaterThanOrEqual(-90);
    expect(countCall.args[0]).toBeLessThanOrEqual(90);
    expect(countCall.args[1]).toBeGreaterThanOrEqual(-90);
    expect(countCall.args[1]).toBeLessThanOrEqual(90);
  });

  it('passes filter params to SQL query', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest(
      'bbox=37.7,-122.5,37.9,-122.2&bedrooms=1&min_price=2000&max_price=4000&has_in_unit_wd=true&max_commute=30&min_safety=5'
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    // Verify db.execute was called (count + data queries)
    expect(db.execute).toHaveBeenCalledTimes(2);

    // Verify SQL args include filter values
    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    expect(countCall.args).toContain(1); // bedrooms
    expect(countCall.args).toContain(4000); // maxPrice
    expect(countCall.args).toContain(2000); // minPrice
    expect(countCall.args).toContain(30); // maxCommute
    expect(countCall.args).toContain(5); // minSafety
  });

  it('handles pagination params', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2&page=2&limit=50');
    const response = await GET(request);
    const data = await response.json();

    expect(data.page).toBe(2);

    // Data query should include limit and offset in args
    const dataCall = vi.mocked(db.execute).mock.calls[1][0] as { sql: string; args: (string | number)[] };
    const args = dataCall.args;
    // Last two args are limit and offset
    expect(args[args.length - 2]).toBe(50); // limit
    expect(args[args.length - 1]).toBe(50); // offset = (2-1) * 50
  });

  it('clamps limit to max 200', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2&limit=9999');
    await GET(request);

    const dataCall = vi.mocked(db.execute).mock.calls[1][0] as { sql: string; args: (string | number)[] };
    const args = dataCall.args;
    expect(args[args.length - 2]).toBe(2000); // clamped to max 2000
  });

  it('filters out NaN values from bedroom_types', async () => {
    const countResult = {
      rows: [{ total: 1 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    const dataResult = {
      rows: [{
        id: 4, name: 'Mixed Beds', address: '',
        lat: 37.8, lng: -122.3,
        website_url: '', phone: null,
        nearest_station_id: null, walk_min_to_bart: null,
        has_in_unit_wd: 0, has_dishwasher: 0,
        has_parking: 0, parking_type: null,
        has_gym: 0, has_pool: 0,
        pet_friendly: 0, year_built: null,
        scrape_status: 'active',
        min_price: null, max_price: null,
        bedroom_types: '1,abc,2,xyz,3',
        station_name: null, travel_time_to_montgomery: null,
        fare_to_montgomery: null, safety_score: null,
      }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(countResult)
      .mockResolvedValueOnce(dataResult);

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    const data = await response.json();

    // NaN values from 'abc' and 'xyz' should be filtered out
    expect(data.apartments[0].bedroomTypes).toEqual([1, 2, 3]);
    // Must not contain NaN
    expect(data.apartments[0].bedroomTypes.every((n: number) => !isNaN(n))).toBe(true);
  });

  it('returns 500 on database error', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('DB error'));

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch apartments');
  });

  it('returns 400 when bbox has some valid and some invalid numbers', async () => {
    const request = makeRequest('bbox=37.7,-122.5,abc,-122.2');
    const response = await GET(request);
    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('4 valid numbers');
  });

  it('verifies has_dishwasher filter adds SQL condition when true', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2&has_dishwasher=true');
    await GET(request);

    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    expect(countCall.sql).toContain('a.has_dishwasher = 1');
  });

  it('does NOT add dishwasher condition when has_dishwasher is absent', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    await GET(request);

    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    expect(countCall.sql).not.toContain('a.has_dishwasher = 1');
  });

  it('does NOT add min_price condition when min_price is absent', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2&max_price=3000');
    await GET(request);

    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    expect(countCall.sql).toContain('fp3.price_min <= ?');
    expect(countCall.sql).not.toContain('fp4');
  });

  it('adds min_safety condition with correct SQL when present', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2&min_safety=5');
    await GET(request);

    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    expect(countCall.sql).toContain('latest_crime.safety_score >= ?');
    expect(countCall.args).toContain(5);
  });

  it('does NOT add safety condition when min_safety is absent', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    await GET(request);

    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    expect(countCall.sql).not.toContain('safety_score');
  });

  it('adds maxCommute condition with correct SQL', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2&max_commute=30');
    await GET(request);

    const countCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: (string | number)[] };
    expect(countCall.sql).toContain('s.travel_time_to_montgomery <= ?');
  });

  it('correctly maps hasGym and hasPool as booleans', async () => {
    const countResult = {
      rows: [{ total: 1 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    const dataResult = {
      rows: [{
        id: 2, name: 'Gym Pool Apt', address: '456 Oak',
        lat: 37.8, lng: -122.3,
        website_url: 'https://test.com', phone: null,
        nearest_station_id: null, walk_min_to_bart: null,
        has_in_unit_wd: 0, has_dishwasher: 0,
        has_parking: 0, parking_type: null,
        has_gym: 1, has_pool: 1,
        pet_friendly: 0, year_built: null,
        scrape_status: 'active',
        min_price: null, max_price: null,
        bedroom_types: null,
        station_name: null, travel_time_to_montgomery: null,
        fare_to_montgomery: null, safety_score: null,
      }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(countResult)
      .mockResolvedValueOnce(dataResult);

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    const data = await response.json();

    // These assertions kill !!row.has_gym -> !row.has_gym mutants
    expect(data.apartments[0].hasGym).toBe(true);
    expect(data.apartments[0].hasPool).toBe(true);
  });

  it('correctly maps hasGym=false and hasPool=false when 0', async () => {
    const countResult = {
      rows: [{ total: 1 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    const dataResult = {
      rows: [{
        id: 3, name: 'Basic Apt', address: '789 Pine',
        lat: 37.8, lng: -122.3,
        website_url: 'https://test.com', phone: null,
        nearest_station_id: null, walk_min_to_bart: null,
        has_in_unit_wd: 0, has_dishwasher: 0,
        has_parking: 0, parking_type: null,
        has_gym: 0, has_pool: 0,
        pet_friendly: 0, year_built: null,
        scrape_status: 'active',
        min_price: null, max_price: null,
        bedroom_types: null,
        station_name: null, travel_time_to_montgomery: null,
        fare_to_montgomery: null, safety_score: null,
      }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(countResult)
      .mockResolvedValueOnce(dataResult);

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    const data = await response.json();

    expect(data.apartments[0].hasGym).toBe(false);
    expect(data.apartments[0].hasPool).toBe(false);
  });

  it('sets Cache-Control header on success', async () => {
    const emptyResult = {
      rows: [{ total: 0 }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    };

    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [] });

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
  });
});
