import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cleanupTestDb } from './setup';

vi.mock('@/db/client', async () => {
  const { setupTestDb } = await import('./setup');
  const testDb = await setupTestDb();
  return { db: testDb };
});

const { GET } = await import('@/app/api/stations/route');

afterAll(async () => {
  await cleanupTestDb();
});

describe('GET /api/stations', () => {
  it('returns all stations with correct fields', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stations).toHaveLength(3);

    const station = data.stations.find((s: any) => s.id === 'EMBR');
    expect(station).toBeDefined();
    expect(station.name).toBe('Embarcadero');
    expect(station.lat).toBe(37.7929);
    expect(station.lng).toBe(-122.397);
    expect(station.lineColors).toEqual(['yellow', 'red', 'blue', 'green']);
    expect(station.travelTimeMin).toBe(4);
    expect(station.fareCents).toBe(255);
    expect(station.monthlyCommuteCost).toBe(10519);
  });

  it('returns stations sorted by name', async () => {
    const response = await GET();
    const data = await response.json();

    const names = data.stations.map((s: any) => s.name);
    expect(names).toEqual(['Embarcadero', 'Montgomery St.', 'Walnut Creek']);
  });

  it('includes safetyScore from crime_stats', async () => {
    const response = await GET();
    const data = await response.json();

    const embr = data.stations.find((s: any) => s.id === 'EMBR');
    expect(embr.safetyScore).toBe(6.5);

    const wcrk = data.stations.find((s: any) => s.id === 'WCRK');
    expect(wcrk.safetyScore).toBe(8.5);

    // MONT has no crime stats
    const mont = data.stations.find((s: any) => s.id === 'MONT');
    expect(mont.safetyScore).toBeNull();
  });

  it('sets Cache-Control header', async () => {
    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
  });
});
