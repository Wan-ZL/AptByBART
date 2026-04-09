import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { cleanupTestDb } from './setup';

vi.mock('@/db/client', async () => {
  const { setupTestDb } = await import('./setup');
  const testDb = await setupTestDb();
  return { db: testDb };
});

const { GET } = await import('@/app/api/apartments/route');

afterAll(async () => {
  await cleanupTestDb();
});

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:4000/api/apartments');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe('GET /api/apartments', () => {
  it('returns 400 when bbox is missing', async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('bbox');
  });

  it('returns 400 when bbox has invalid numbers', async () => {
    const response = await GET(makeRequest({ bbox: 'a,b,c,d' }));
    expect(response.status).toBe(400);
  });

  it('returns apartments within bbox', async () => {
    // Bbox covering SF area (includes Test Apt 1 at 37.79, -122.40)
    const response = await GET(
      makeRequest({ bbox: '37.78,-122.41,37.80,-122.39' })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.apartments).toHaveLength(1);
    expect(data.apartments[0].name).toBe('Test Apt 1');
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
  });

  it('returns no apartments for bbox outside data', async () => {
    const response = await GET(
      makeRequest({ bbox: '40.00,-120.00,41.00,-119.00' })
    );
    const data = await response.json();

    expect(data.apartments).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  it('returns all apartments with wide bbox', async () => {
    const response = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00' })
    );
    const data = await response.json();

    expect(data.apartments).toHaveLength(2);
  });

  it('filters by bedrooms', async () => {
    // Both apartments have 1BR plans
    const response = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00', bedrooms: '1' })
    );
    const data = await response.json();
    expect(data.apartments).toHaveLength(2);

    // Only Test Apt 1 has a studio (0 bedrooms)
    const response2 = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00', bedrooms: '0' })
    );
    const data2 = await response2.json();
    expect(data2.apartments).toHaveLength(1);
    expect(data2.apartments[0].name).toBe('Test Apt 1');

    // Only Test Apt 2 has 2BR
    const response3 = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00', bedrooms: '2' })
    );
    const data3 = await response3.json();
    expect(data3.apartments).toHaveLength(1);
    expect(data3.apartments[0].name).toBe('Test Apt 2');
  });

  it('filters by max_price', async () => {
    // price_min <= 2200 -> only Test Apt 1 (Studio has price_min=2100)
    const response = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00', max_price: '2200' })
    );
    const data = await response.json();
    expect(data.apartments).toHaveLength(1);
    expect(data.apartments[0].name).toBe('Test Apt 1');
  });

  it('filters by min_price', async () => {
    // price_min >= 2400 -> both apartments have plans at or above 2400
    const response = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00', min_price: '2400' })
    );
    const data = await response.json();
    expect(data.apartments).toHaveLength(2);

    // price_min >= 3200 -> only Test Apt 2 (2BR has price_min=3200)
    const response2 = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00', min_price: '3200' })
    );
    const data2 = await response2.json();
    expect(data2.apartments).toHaveLength(1);
    expect(data2.apartments[0].name).toBe('Test Apt 2');
  });

  it('filters by amenities (has_in_unit_wd)', async () => {
    // Only Test Apt 1 has in-unit W/D
    const response = await GET(
      makeRequest({
        bbox: '37.00,-123.00,38.00,-122.00',
        has_in_unit_wd: 'true',
      })
    );
    const data = await response.json();
    expect(data.apartments).toHaveLength(1);
    expect(data.apartments[0].name).toBe('Test Apt 1');
    expect(data.apartments[0].hasInUnitWd).toBe(true);
  });

  it('filters by has_parking', async () => {
    const response = await GET(
      makeRequest({
        bbox: '37.00,-123.00,38.00,-122.00',
        has_parking: 'true',
      })
    );
    const data = await response.json();
    expect(data.apartments).toHaveLength(1);
    expect(data.apartments[0].name).toBe('Test Apt 1');
    expect(data.apartments[0].parkingType).toBe('garage');
  });

  it('respects pagination (page and limit)', async () => {
    // Get first page with limit=1
    const response1 = await GET(
      makeRequest({
        bbox: '37.00,-123.00,38.00,-122.00',
        limit: '1',
        page: '1',
      })
    );
    const data1 = await response1.json();
    expect(data1.apartments).toHaveLength(1);
    expect(data1.total).toBe(2);
    expect(data1.page).toBe(1);
    expect(data1.apartments[0].name).toBe('Test Apt 1'); // sorted by name

    // Get second page
    const response2 = await GET(
      makeRequest({
        bbox: '37.00,-123.00,38.00,-122.00',
        limit: '1',
        page: '2',
      })
    );
    const data2 = await response2.json();
    expect(data2.apartments).toHaveLength(1);
    expect(data2.apartments[0].name).toBe('Test Apt 2');
  });

  it('returns minPrice from floor_plans', async () => {
    const response = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00' })
    );
    const data = await response.json();

    const apt1 = data.apartments.find((a: any) => a.name === 'Test Apt 1');
    expect(apt1.minPrice).toBe(2100); // min of Studio(2100) and 1BR(2800)

    const apt2 = data.apartments.find((a: any) => a.name === 'Test Apt 2');
    expect(apt2.minPrice).toBe(2400); // min of 1BR(2400) and 2BR(3200)
  });

  it('includes station info and safety score', async () => {
    const response = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00' })
    );
    const data = await response.json();

    const apt1 = data.apartments.find((a: any) => a.name === 'Test Apt 1');
    expect(apt1.nearestStationId).toBe('EMBR');
    expect(apt1.stationName).toBe('Embarcadero');
    expect(apt1.travelTimeMin).toBe(4);
    expect(apt1.safetyScore).toBe(6.5);
  });

  it('sets Cache-Control header', async () => {
    const response = await GET(
      makeRequest({ bbox: '37.00,-123.00,38.00,-122.00' })
    );
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=3600'
    );
  });
});
