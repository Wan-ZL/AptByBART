import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db client before importing the route handler
vi.mock('@/db/client', () => ({
  db: {
    execute: vi.fn(),
    batch: vi.fn(),
  },
}));

// Mock NextResponse since we're outside Next.js runtime
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

import { GET } from '@/app/api/stations/route';
import { db } from '@/db/client';

describe('GET /api/stations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stations from database', async () => {
    const mockRows = [
      {
        id: 'MONT',
        name: 'Montgomery St.',
        lat: 37.7894,
        lng: -122.4013,
        line_colors: '["yellow","green"]',
        travel_time_to_montgomery: 0,
        fare_to_montgomery: 0,
        monthly_commute_cost: 0,
        safety_score: 8,
      },
      {
        id: 'DALY',
        name: 'Daly City',
        lat: 37.7063,
        lng: -122.4693,
        line_colors: '["blue","green"]',
        travel_time_to_montgomery: 20,
        fare_to_montgomery: 440,
        monthly_commute_cost: 176,
        safety_score: 6,
      },
    ];

    vi.mocked(db.execute).mockResolvedValue({
      rows: mockRows,
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    });

    const response = await GET();
    const data = await response.json();

    expect(data.stations).toHaveLength(2);
    expect(data.stations[0].id).toBe('MONT');
    expect(data.stations[0].lineColors).toEqual(['yellow', 'green']);
    expect(data.stations[0].travelTimeMin).toBe(0);
    expect(data.stations[1].fareCents).toBe(440);
    expect(data.stations[1].safetyScore).toBe(6);
  });

  it('returns empty array when no stations exist', async () => {
    vi.mocked(db.execute).mockResolvedValue({
      rows: [],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    });

    const response = await GET();
    const data = await response.json();

    expect(data.stations).toEqual([]);
  });

  it('handles stations with null line_colors', async () => {
    vi.mocked(db.execute).mockResolvedValue({
      rows: [{
        id: 'TEST',
        name: 'Test',
        lat: 37.0,
        lng: -122.0,
        line_colors: null,
        travel_time_to_montgomery: null,
        fare_to_montgomery: null,
        monthly_commute_cost: null,
        safety_score: null,
      }],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    });

    const response = await GET();
    const data = await response.json();

    expect(data.stations[0].lineColors).toEqual([]);
    expect(data.stations[0].travelTimeMin).toBeNull();
    expect(data.stations[0].safetyScore).toBeNull();
  });

  it('returns 500 on database error', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('DB connection failed'));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch stations');
  });

  it('sets Cache-Control header on success', async () => {
    vi.mocked(db.execute).mockResolvedValue({
      rows: [],
      columns: [],
      columnTypes: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({}),
    });

    const response = await GET();
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
  });
});
