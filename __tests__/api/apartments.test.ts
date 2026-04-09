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

  it('returns apartments with valid bbox', async () => {
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
        min_price: 2500,
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
    expect(data.apartments[0].name).toBe('Test Apt');
    expect(data.apartments[0].hasInUnitWd).toBe(true);
    expect(data.apartments[0].hasDishwasher).toBe(false);
    expect(data.apartments[0].hasParking).toBe(true);
    expect(data.apartments[0].petFriendly).toBe(true);
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
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

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2&limit=999');
    await GET(request);

    const dataCall = vi.mocked(db.execute).mock.calls[1][0] as { sql: string; args: (string | number)[] };
    const args = dataCall.args;
    expect(args[args.length - 2]).toBe(200); // clamped
  });

  it('returns 500 on database error', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('DB error'));

    const request = makeRequest('bbox=37.7,-122.5,37.9,-122.2');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch apartments');
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
