import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrimeObservation } from '@/lib/crime-taxonomy';

// Mock socrata-client before importing the ingester
vi.mock('../../scripts/ingest/socrata-client', () => ({
  fetchSocrata: vi.fn(),
}));

import { datasfIngester } from '@/scripts/ingest/datasf';
import { fetchSocrata } from '../../scripts/ingest/socrata-client';

const mockFetchSocrata = vi.mocked(fetchSocrata);

beforeEach(() => {
  mockFetchSocrata.mockReset();
});

describe('datasfIngester', () => {
  describe('metadata', () => {
    it('has sourceId "datasf"', () => {
      expect(datasfIngester.sourceId).toBe('datasf');
    });

    it('has apiType "socrata"', () => {
      expect(datasfIngester.apiType).toBe('socrata');
    });

    it('has granularity "neighborhood"', () => {
      expect(datasfIngester.granularity).toBe('neighborhood');
    });
  });

  describe('category mapping correctness', () => {
    it('maps Assault to violent', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '150' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('violent');
      expect(obs[0].incidentCount).toBe(150);
    });

    it('maps Larceny Theft to property', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Larceny Theft', cnt: '500' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('property');
      expect(obs[0].incidentCount).toBe(500);
    });

    it('maps Motor Vehicle Theft to vehicle', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Motor Vehicle Theft', cnt: '80' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('vehicle');
      expect(obs[0].incidentCount).toBe(80);
    });

    it('maps Drug Offense to quality_of_life', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Drug Offense', cnt: '200' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('quality_of_life');
      expect(obs[0].incidentCount).toBe(200);
    });

    it('maps Robbery to violent', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Tenderloin', incident_category: 'Robbery', cnt: '100' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('violent');
    });

    it('processes multiple rows with different categories', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '150' },
        { analysis_neighborhood: 'Mission', incident_category: 'Larceny Theft', cnt: '500' },
        { analysis_neighborhood: 'Mission', incident_category: 'Motor Vehicle Theft', cnt: '80' },
        { analysis_neighborhood: 'Mission', incident_category: 'Drug Offense', cnt: '200' },
        { analysis_neighborhood: 'Tenderloin', incident_category: 'Robbery', cnt: '100' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(5);

      const categories = obs.map((o) => o.category);
      expect(categories).toContain('violent');
      expect(categories).toContain('property');
      expect(categories).toContain('vehicle');
      expect(categories).toContain('quality_of_life');
    });
  });

  describe('slug generation', () => {
    beforeEach(() => {
      mockFetchSocrata.mockImplementation(async () => []);
    });

    async function slugFor(neighborhood: string): Promise<string> {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: neighborhood, incident_category: 'Assault', cnt: '10' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      return obs[0].geoAreaId;
    }

    it('converts "Mission" to neighborhood:mission', async () => {
      expect(await slugFor('Mission')).toBe('neighborhood:mission');
    });

    it('converts "South of Market" to neighborhood:south_of_market', async () => {
      expect(await slugFor('South of Market')).toBe('neighborhood:south_of_market');
    });

    it('converts "Financial District/South Beach" to neighborhood:financial_district_south_beach', async () => {
      expect(await slugFor('Financial District/South Beach')).toBe(
        'neighborhood:financial_district_south_beach'
      );
    });

    it('converts "Bayview Hunters Point" to neighborhood:bayview_hunters_point', async () => {
      expect(await slugFor('Bayview Hunters Point')).toBe('neighborhood:bayview_hunters_point');
    });

    it('handles neighborhoods with apostrophes', async () => {
      expect(await slugFor("Fisherman's Wharf")).toBe('neighborhood:fisherman_s_wharf');
    });

    it('strips trailing underscores from slug', async () => {
      // A neighborhood ending with a special char like "Test!" would produce "test_" without stripping
      expect(await slugFor('Test!')).toBe('neighborhood:test');
    });
  });

  describe('unmapped categories', () => {
    it('excludes rows with unmapped incident_category', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Miscellaneous Investigation', cnt: '50' },
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '10' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('violent');
      expect(obs[0].rawCategory).toBe('Assault');
    });

    it('returns empty array when all categories are unmapped', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Miscellaneous Investigation', cnt: '50' },
        { analysis_neighborhood: 'Mission', incident_category: 'Non Criminal', cnt: '30' },
        { analysis_neighborhood: 'Mission', incident_category: 'Traffic Violation Arrest', cnt: '20' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(0);
    });
  });

  describe('empty/null handling', () => {
    it('skips rows with empty analysis_neighborhood', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: '', incident_category: 'Assault', cnt: '50' },
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '10' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].geoAreaId).toBe('neighborhood:mission');
    });

    it('skips rows with zero count', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '0' },
        { analysis_neighborhood: 'Mission', incident_category: 'Robbery', cnt: '5' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('violent');
      expect(obs[0].incidentCount).toBe(5);
    });

    it('skips rows with non-numeric count (NaN becomes 0)', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: 'abc' },
        { analysis_neighborhood: 'Mission', incident_category: 'Robbery', cnt: '5' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
    });

    it('skips rows with missing rawCategory', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: '', cnt: '50' },
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '10' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);
    });

    it('returns empty array for empty API response', async () => {
      mockFetchSocrata.mockResolvedValue([]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(0);
    });
  });

  describe('period dates', () => {
    it('sets periodStart to approximately 12 months ago', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '10' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);

      const periodStart = new Date(obs[0].periodStart);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      // Allow 1 day tolerance for test timing
      const diffMs = Math.abs(periodStart.getTime() - oneYearAgo.getTime());
      expect(diffMs).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it('sets periodEnd to today', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '10' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs).toHaveLength(1);

      const today = new Date().toISOString().split('T')[0];
      expect(obs[0].periodEnd).toBe(today);
    });

    it('periodStart and periodEnd are YYYY-MM-DD format strings', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '10' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs[0].periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(obs[0].periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('source metadata', () => {
    it('sets sourceId to "datasf" on all observations', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '150' },
        { analysis_neighborhood: 'Tenderloin', incident_category: 'Robbery', cnt: '100' },
        { analysis_neighborhood: 'Richmond', incident_category: 'Larceny Theft', cnt: '75' },
      ]);
      const obs = await datasfIngester.fetch();
      for (const o of obs) {
        expect(o.sourceId).toBe('datasf');
      }
    });

    it('preserves rawCategory on each observation', async () => {
      mockFetchSocrata.mockResolvedValue([
        { analysis_neighborhood: 'Mission', incident_category: 'Assault', cnt: '150' },
        { analysis_neighborhood: 'Mission', incident_category: 'Larceny Theft', cnt: '500' },
      ]);
      const obs = await datasfIngester.fetch();
      expect(obs[0].rawCategory).toBe('Assault');
      expect(obs[1].rawCategory).toBe('Larceny Theft');
    });
  });

  describe('fetchSocrata call parameters', () => {
    it('passes correct domain and datasetId', async () => {
      mockFetchSocrata.mockResolvedValue([]);
      await datasfIngester.fetch();

      expect(mockFetchSocrata).toHaveBeenCalledOnce();
      const args = mockFetchSocrata.mock.calls[0][0];
      expect(args.domain).toBe('data.sfgov.org');
      expect(args.datasetId).toBe('wg3w-h783');
    });

    it('requests aggregated data with GROUP BY', async () => {
      mockFetchSocrata.mockResolvedValue([]);
      await datasfIngester.fetch();

      const args = mockFetchSocrata.mock.calls[0][0];
      expect(args.select).toContain('count(*)');
      expect(args.group).toContain('analysis_neighborhood');
      expect(args.group).toContain('incident_category');
    });

    it('filters by date ~12 months ago', async () => {
      mockFetchSocrata.mockResolvedValue([]);
      await datasfIngester.fetch();

      const args = mockFetchSocrata.mock.calls[0][0];
      // The where clause should contain a date roughly 1 year ago
      const dateMatch = args.where?.match(/(\d{4}-\d{2}-\d{2})/);
      expect(dateMatch).not.toBeNull();

      const filterDate = new Date(dateMatch![1]);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const diffMs = Math.abs(filterDate.getTime() - oneYearAgo.getTime());
      expect(diffMs).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it('sets limit to 50000', async () => {
      mockFetchSocrata.mockResolvedValue([]);
      await datasfIngester.fetch();

      const args = mockFetchSocrata.mock.calls[0][0];
      expect(args.limit).toBe(50000);
    });
  });
});
