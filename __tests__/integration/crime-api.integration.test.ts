import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { cleanupTestDb } from './setup';

vi.mock('@/db/client', async () => {
  const { setupTestDb } = await import('./setup');
  const testDb = await setupTestDb();
  return { db: testDb };
});

const { GET } = await import('@/app/api/stations/[id]/crime/route');

afterAll(async () => {
  await cleanupTestDb();
});

function makeRequest(id: string): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:4000/api/stations/${id}/crime`)
  );
}

describe('GET /api/stations/:id/crime', () => {
  it('returns monthly crime data for a station', async () => {
    const response = await GET(makeRequest('EMBR'), {
      params: Promise.resolve({ id: 'EMBR' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stationId).toBe('EMBR');
    expect(data.months).toHaveLength(1);

    const month = data.months[0];
    expect(month.year).toBe(2026);
    expect(month.month).toBe(1);
    expect(month.violent).toBe(15);
    expect(month.property).toBe(45);
    expect(month.vehicle).toBe(30);
    expect(month.total).toBe(90);
    expect(month.safetyScore).toBe(6.5);
  });

  it('returns different data for another station', async () => {
    const response = await GET(makeRequest('WCRK'), {
      params: Promise.resolve({ id: 'WCRK' }),
    });
    const data = await response.json();

    expect(data.stationId).toBe('WCRK');
    expect(data.months).toHaveLength(1);
    expect(data.months[0].violent).toBe(3);
    expect(data.months[0].total).toBe(18);
    expect(data.months[0].safetyScore).toBe(8.5);
  });

  it('returns empty months for station with no crime data', async () => {
    const response = await GET(makeRequest('MONT'), {
      params: Promise.resolve({ id: 'MONT' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stationId).toBe('MONT');
    expect(data.months).toHaveLength(0);
  });

  it('returns empty months for non-existent station', async () => {
    const response = await GET(makeRequest('FAKE'), {
      params: Promise.resolve({ id: 'FAKE' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stationId).toBe('FAKE');
    expect(data.months).toHaveLength(0);
  });

  it('sets Cache-Control header', async () => {
    const response = await GET(makeRequest('EMBR'), {
      params: Promise.resolve({ id: 'EMBR' }),
    });
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
  });
});
