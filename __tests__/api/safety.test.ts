import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/client', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('@/lib/safety-scoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/safety-scoring')>();
  return {
    ...actual,
    computeSafetyScores: vi.fn(actual.computeSafetyScores),
  };
});

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

import { GET } from '@/app/api/safety/route';
import { db } from '@/db/client';
import { DEFAULT_WEIGHTS } from '@/lib/crime-taxonomy';

function makeRequest(params: string = '') {
  const { NextRequest } = require('next/server');
  return new NextRequest(`http://localhost:4000/api/safety${params ? '?' + params : ''}`);
}

function makeDbResult(rows: Record<string, unknown>[] = []) {
  return {
    rows,
    columns: [],
    columnTypes: [],
    rowsAffected: 0,
    lastInsertRowid: undefined,
    toJSON: () => ({}),
  };
}

const SAMPLE_SAFETY_ROW = {
  geo_area_id: 'sf-mission',
  score: 6.5,
  percentile_rank: 45,
  violent_count: 120,
  property_count: 300,
  vehicle_count: 80,
  quality_of_life_count: 50,
  updated_at: '2026-04-01T00:00:00Z',
  name: 'Mission',
  area_type: 'neighborhood',
  parent_area_id: 'sf',
  centroid_lat: 37.76,
  centroid_lng: -122.42,
};

const SAMPLE_SAFETY_ROW_2 = {
  geo_area_id: 'sf-downtown',
  score: 4.2,
  percentile_rank: 20,
  violent_count: 250,
  property_count: 500,
  vehicle_count: 200,
  quality_of_life_count: 150,
  updated_at: '2026-04-01T00:00:00Z',
  name: 'Downtown',
  area_type: 'neighborhood',
  parent_area_id: 'sf',
  centroid_lat: 37.79,
  centroid_lng: -122.40,
};

const SAMPLE_CITY_ROW = {
  geo_area_id: 'sf',
  score: 5.5,
  percentile_rank: 50,
  violent_count: 1000,
  property_count: 3000,
  vehicle_count: 800,
  quality_of_life_count: 500,
  updated_at: '2026-04-01T00:00:00Z',
  name: 'San Francisco',
  area_type: 'city',
  parent_area_id: null,
  centroid_lat: 37.77,
  centroid_lng: -122.42,
};

const SAMPLE_SOURCES = [
  { geo_area_id: 'sf-mission', source_id: 'datasf' },
  { geo_area_id: 'sf-mission', source_id: 'ca_doj' },
  { geo_area_id: 'sf-downtown', source_id: 'datasf' },
];

describe('GET /api/safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns areas with correct shape on default request (no params)', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW, SAMPLE_SAFETY_ROW_2]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.areas).toHaveLength(2);
    expect(data.weights).toEqual(DEFAULT_WEIGHTS);
    expect(typeof data.lastUpdated).toBe('string');

    const area = data.areas[0];
    expect(area).toEqual({
      id: 'sf-mission',
      name: 'Mission',
      type: 'neighborhood',
      parentId: 'sf',
      score: 6.5,
      percentileRank: 45,
      counts: {
        violent: 120,
        property: 300,
        vehicle: 80,
        qualityOfLife: 50,
      },
      sources: ['datasf', 'ca_doj'],
      centroidLat: 37.76,
      centroidLng: -122.42,
    });
  });

  it('scores are numbers, not strings', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest());
    const data = await response.json();

    const area = data.areas[0];
    expect(typeof area.score).toBe('number');
    expect(typeof area.percentileRank).toBe('number');
    expect(typeof area.counts.violent).toBe('number');
    expect(typeof area.counts.property).toBe('number');
    expect(typeof area.counts.vehicle).toBe('number');
    expect(typeof area.counts.qualityOfLife).toBe('number');
  });

  it('filters by granularity=city', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_CITY_ROW]))
      .mockResolvedValueOnce(makeDbResult([{ geo_area_id: 'sf', source_id: 'datasf' }]));

    const response = await GET(makeRequest('granularity=city'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.areas).toHaveLength(1);
    expect(data.areas[0].type).toBe('city');

    // Verify the SQL used WHERE clause with granularity arg
    const firstCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: string[] };
    expect(firstCall.sql).toContain('WHERE ga.area_type = ?');
    expect(firstCall.args).toContain('city');
  });

  it('filters by granularity=neighborhood', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest('granularity=neighborhood'));
    const data = await response.json();

    expect(response.status).toBe(200);
    const firstCall = vi.mocked(db.execute).mock.calls[0][0] as { sql: string; args: string[] };
    expect(firstCall.sql).toContain('WHERE ga.area_type = ?');
    expect(firstCall.args).toContain('neighborhood');
  });

  it('ignores invalid granularity and returns all areas', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW, SAMPLE_CITY_ROW]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest('granularity=invalid'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.areas).toHaveLength(2);

    // Should NOT have WHERE clause since granularity is invalid
    const firstCall = vi.mocked(db.execute).mock.calls[0][0];
    // When no granularity filter, execute is called with a plain string, not an object
    expect(typeof firstCall).toBe('string');
  });

  it('recomputes scores with custom weights param', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW, SAMPLE_SAFETY_ROW_2]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest('weights=5,1,0.5,0.5'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.weights).toEqual({
      violent: 5,
      property: 1,
      vehicle: 0.5,
      qualityOfLife: 0.5,
    });

    // With custom weights emphasizing violent crime, scores should differ from DB values
    // The area with more violent crime (downtown: 250) should score lower than mission (120)
    const missionArea = data.areas.find((a: { id: string }) => a.id === 'sf-mission');
    const downtownArea = data.areas.find((a: { id: string }) => a.id === 'sf-downtown');
    expect(missionArea.score).toBeGreaterThan(downtownArea.score);

    // Scores should be different from DB scores since weights are custom
    expect(typeof missionArea.score).toBe('number');
    expect(typeof missionArea.percentileRank).toBe('number');
  });

  it('returns empty areas array when database has no data', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([]));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.areas).toEqual([]);
    expect(data.weights).toEqual(DEFAULT_WEIGHTS);
    expect(typeof data.lastUpdated).toBe('string');

    // Should NOT call db.execute a second time for sources when no areas
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('sets Cache-Control header on success', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest());
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  it('sets Cache-Control header on empty response', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([]));

    const response = await GET(makeRequest());
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  it('handles "no such table" error gracefully', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('no such table: safety_scores'));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.areas).toEqual([]);
    expect(data.weights).toEqual(DEFAULT_WEIGHTS);
    expect(typeof data.lastUpdated).toBe('string');
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  it('returns 500 on non-table database error', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('connection refused'));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch safety data');
  });

  it('maps sources correctly per area', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW, SAMPLE_SAFETY_ROW_2]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest());
    const data = await response.json();

    const mission = data.areas.find((a: { id: string }) => a.id === 'sf-mission');
    const downtown = data.areas.find((a: { id: string }) => a.id === 'sf-downtown');
    expect(mission.sources).toEqual(['datasf', 'ca_doj']);
    expect(downtown.sources).toEqual(['datasf']);
  });

  it('returns empty sources array for area with no crime observations', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW]))
      .mockResolvedValueOnce(makeDbResult([])); // no sources

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(data.areas[0].sources).toEqual([]);
  });

  it('handles null parent_area_id', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_CITY_ROW])) // city has null parent
      .mockResolvedValueOnce(makeDbResult([]));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(data.areas[0].parentId).toBeNull();
  });

  it('uses default score of 5 when DB score is null', async () => {
    const rowWithNullScore = { ...SAMPLE_SAFETY_ROW, score: null, percentile_rank: null };
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([rowWithNullScore]))
      .mockResolvedValueOnce(makeDbResult([]));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(data.areas[0].score).toBe(5);
    expect(data.areas[0].percentileRank).toBeNull();
  });

  it('ignores invalid weights param and uses defaults', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    // Only 3 parts instead of 4
    const response = await GET(makeRequest('weights=5,1,0.5'));
    const data = await response.json();

    expect(data.weights).toEqual(DEFAULT_WEIGHTS);
    // Score should be the DB value, not recomputed
    expect(data.areas[0].score).toBe(6.5);
  });

  it('ignores negative weights', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW]))
      .mockResolvedValueOnce(makeDbResult(SAMPLE_SOURCES));

    const response = await GET(makeRequest('weights=5,-1,0.5,0.5'));
    const data = await response.json();

    // Negative weights should be rejected, use defaults
    expect(data.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('rounds scores to one decimal place', async () => {
    vi.mocked(db.execute)
      .mockResolvedValueOnce(makeDbResult([SAMPLE_SAFETY_ROW]))
      .mockResolvedValueOnce(makeDbResult([]));

    const response = await GET(makeRequest());
    const data = await response.json();

    const score = data.areas[0].score;
    // score * 10 should be an integer (one decimal place)
    expect(Math.round(score * 10)).toBe(score * 10);
  });
});
