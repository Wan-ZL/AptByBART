import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { cleanupTestDb } from './setup';

vi.mock('@/db/client', async () => {
  const { setupTestDb } = await import('./setup');
  const testDb = await setupTestDb();
  return { db: testDb };
});

const { GET } = await import('@/app/api/apartments/[id]/route');

afterAll(async () => {
  await cleanupTestDb();
});

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost:4000/api/apartments/1'));
}

describe('GET /api/apartments/:id', () => {
  it('returns apartment detail with floor plans', async () => {
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: '1' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.apartment.id).toBe(1);
    expect(data.apartment.name).toBe('Test Apt 1');
    expect(data.apartment.address).toBe('100 Main St');
    expect(data.apartment.lat).toBe(37.79);
    expect(data.apartment.lng).toBe(-122.4);
    expect(data.apartment.websiteUrl).toBe('https://test1.com');
    expect(data.apartment.walkMinToBart).toBe(5);
    expect(data.apartment.hasInUnitWd).toBe(true);
    expect(data.apartment.hasDishwasher).toBe(true);
    expect(data.apartment.hasParking).toBe(true);
    expect(data.apartment.parkingType).toBe('garage');
  });

  it('includes floor plans sorted by bedrooms and price', async () => {
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: '1' }),
    });
    const data = await response.json();

    expect(data.apartment.floorPlans).toHaveLength(2);

    const studio = data.apartment.floorPlans[0];
    expect(studio.name).toBe('Studio');
    expect(studio.bedrooms).toBe(0);
    expect(studio.bathrooms).toBe(1);
    expect(studio.sqftMin).toBe(400);
    expect(studio.sqftMax).toBe(450);
    expect(studio.priceMin).toBe(2100);
    expect(studio.priceMax).toBe(2300);
    expect(studio.availableUnits).toBe(3);

    const oneBr = data.apartment.floorPlans[1];
    expect(oneBr.name).toBe('1BR');
    expect(oneBr.bedrooms).toBe(1);
    expect(oneBr.priceMin).toBe(2800);
  });

  it('includes nearest station info with safety score', async () => {
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: '1' }),
    });
    const data = await response.json();

    expect(data.apartment.nearestStation).toEqual({
      id: 'EMBR',
      name: 'Embarcadero',
      travelTimeMin: 4,
      fareCents: 255,
      monthlyCommuteCost: 10519,
      safetyScore: 6.5,
    });
  });

  it('returns 404 for non-existent apartment', async () => {
    const response = await GET(
      new NextRequest(new URL('http://localhost:4000/api/apartments/999')),
      { params: Promise.resolve({ id: '999' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Apartment not found');
  });

  it('includes price history (empty when no history)', async () => {
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: '1' }),
    });
    const data = await response.json();

    // priceHistory exists but is empty since we didn't seed price_history
    expect(data.apartment.priceHistory).toBeDefined();
    expect(typeof data.apartment.priceHistory).toBe('object');
  });

  it('returns apartment 2 with correct station info', async () => {
    const response = await GET(
      new NextRequest(new URL('http://localhost:4000/api/apartments/2')),
      { params: Promise.resolve({ id: '2' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.apartment.name).toBe('Test Apt 2');
    expect(data.apartment.hasInUnitWd).toBe(false);
    expect(data.apartment.hasParking).toBe(false);
    expect(data.apartment.nearestStation.id).toBe('WCRK');
    expect(data.apartment.nearestStation.safetyScore).toBe(8.5);
    expect(data.apartment.floorPlans).toHaveLength(2);
  });

  it('sets Cache-Control header', async () => {
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: '1' }),
    });
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=3600'
    );
  });
});
