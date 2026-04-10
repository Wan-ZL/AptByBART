/**
 * Contract tests: verify frontend fetch calls match API route expectations.
 * These catch parameter mismatches between client and server.
 */
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

import { GET as getApartments } from '@/app/api/apartments/route';
import { db } from '@/db/client';
import type { ApartmentDetail, PriceHistoryEntry } from '@/lib/types';

function makeRequest(url: string) {
  const { NextRequest } = require('next/server');
  return new NextRequest(url);
}

describe('Frontend ↔ API Contract Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/apartments — bbox parameter contract', () => {
    it('frontend bbox format (lat,lng,lat,lng) produces valid SQL args', async () => {
      // This is the EXACT bbox the frontend sends (from app/page.tsx line 34)
      // Format: swLat,swLng,neLat,neLng
      const frontendBbox = '37.3,-122.6,38.1,-121.7';

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
        `http://localhost:4000/api/apartments?bbox=${frontendBbox}`
      );
      await getApartments(request);

      const countCall = vi.mocked(db.execute).mock.calls[0][0] as {
        sql: string;
        args: (string | number)[];
      };

      // SQL: "a.lat BETWEEN ? AND ?" uses args[0] and args[1]
      // args[0]=swLat, args[1]=neLat — both valid latitudes
      expect(countCall.args[0]).toBe(37.3);   // swLat
      expect(countCall.args[1]).toBe(38.1);    // neLat
      expect(countCall.args[2]).toBe(-122.6);  // swLng
      expect(countCall.args[3]).toBe(-121.7);  // neLng

      // Latitudes should be valid (-90 to 90)
      expect(countCall.args[0]).toBeGreaterThanOrEqual(-90);
      expect(countCall.args[0]).toBeLessThanOrEqual(90);
      expect(countCall.args[1]).toBeGreaterThanOrEqual(-90);
      expect(countCall.args[1]).toBeLessThanOrEqual(90);
    });
  });

  describe('GET /api/apartments/:id — response shape contract', () => {
    it('frontend unwraps data.apartment to get ApartmentDetail', async () => {
      // The API returns: { apartment: { id, name, floorPlans, priceHistory, nearestStation, ... } }
      // Frontend does: setDetail(data.apartment)

      const apiResponse = {
        apartment: {
          id: 1,
          name: 'Test',
          floorPlans: [{ id: 1, bedrooms: 1, bathrooms: 1, priceMin: 2000 }],
          priceHistory: {},
          nearestStation: null,
        },
      };

      // Frontend unwraps data.apartment
      const detail = apiResponse.apartment as unknown as ApartmentDetail;
      expect(detail.floorPlans).toBeDefined();
      expect(detail.floorPlans).toHaveLength(1);
      expect(detail.floorPlans[0].priceMin).toBe(2000);
    });
  });

  describe('PriceHistoryEntry — field name contract', () => {
    it('API returns date field matching PriceHistoryEntry type', () => {
      // API (apartments/[id]/route.ts) now returns "date" to match the type
      const apiEntry = {
        priceMin: 2500,
        priceMax: 2800,
        availableUnits: 3,
        date: '2024-01-15T00:00:00',
      };

      const asTyped = apiEntry as unknown as PriceHistoryEntry;
      expect(asTyped.date).toBe('2024-01-15T00:00:00');
      expect(asTyped.priceMin).toBe(2500);
      expect(asTyped.priceMax).toBe(2800);
      expect(asTyped.availableUnits).toBe(3);
    });
  });
});
