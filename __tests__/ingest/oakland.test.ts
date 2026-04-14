import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrimeObservation } from '@/lib/crime-taxonomy';

// Mock socrata-client before importing the ingester
vi.mock('@/scripts/ingest/socrata-client', () => ({
  fetchSocrata: vi.fn(),
}));

import { oaklandIngester } from '@/scripts/ingest/oakland';
import { fetchSocrata } from '@/scripts/ingest/socrata-client';

const mockFetchSocrata = vi.mocked(fetchSocrata);

beforeEach(() => {
  mockFetchSocrata.mockReset();
});

describe('oaklandIngester', () => {
  describe('metadata', () => {
    it('has sourceId "oakland"', () => {
      expect(oaklandIngester.sourceId).toBe('oakland');
    });

    it('uses socrata apiType', () => {
      expect(oaklandIngester.apiType).toBe('socrata');
    });

    it('has beat granularity', () => {
      expect(oaklandIngester.granularity).toBe('beat');
    });
  });

  describe('category mapping', () => {
    it('maps ROBBERY to violent', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '50' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('violent');
    });

    it('maps PETTY THEFT to property', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'PETTY THEFT', cnt: '200' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('property');
    });

    it('maps BURG-AUTO to vehicle', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'BURG-AUTO', cnt: '100' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('vehicle');
    });

    it('maps NARCOTICS to quality_of_life', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '17Y', crimetype: 'NARCOTICS', cnt: '30' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('quality_of_life');
    });

    it('maps HOMICIDE to violent', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '17Y', crimetype: 'HOMICIDE', cnt: '5' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('violent');
    });

    it('maps all categories from mixed input correctly', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '50' },
        { policebeat: '12X', crimetype: 'PETTY THEFT', cnt: '200' },
        { policebeat: '12X', crimetype: 'BURG-AUTO', cnt: '100' },
        { policebeat: '17Y', crimetype: 'NARCOTICS', cnt: '30' },
        { policebeat: '17Y', crimetype: 'HOMICIDE', cnt: '5' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(5);

      const categories = obs.map((o) => o.category);
      expect(categories).toEqual([
        'violent',
        'property',
        'vehicle',
        'quality_of_life',
        'violent',
      ]);
    });
  });

  describe('beat ID slug generation', () => {
    it('lowercases beat ID "12X" to "beat:12x"', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '10' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].geoAreaId).toBe('beat:12x');
    });

    it('lowercases beat ID "17Y" to "beat:17y"', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '17Y', crimetype: 'HOMICIDE', cnt: '5' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].geoAreaId).toBe('beat:17y');
    });

    it('lowercases beat ID "35X" to "beat:35x"', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '35X', crimetype: 'ASSAULT', cnt: '15' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].geoAreaId).toBe('beat:35x');
    });

    it('handles already-lowercase beat IDs', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '04x', crimetype: 'ROBBERY', cnt: '7' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].geoAreaId).toBe('beat:04x');
    });
  });

  describe('crimetype spelling variants', () => {
    it('maps "BURG-AUTO" (no spaces) to vehicle', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'BURG-AUTO', cnt: '50' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('vehicle');
    });

    it('maps "BURG - AUTO" (with spaces) to vehicle', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'BURG - AUTO', cnt: '50' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('vehicle');
    });

    it('maps FELONY ASSAULT to violent', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'FELONY ASSAULT', cnt: '20' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('violent');
    });

    it('maps MISDEMEANOR ASSAULT to violent', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'MISDEMEANOR ASSAULT', cnt: '30' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].category).toBe('violent');
    });

    it('maps BURG-RESIDENTIAL and BURG - RESIDENTIAL to property', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'BURG-RESIDENTIAL', cnt: '10' },
        { policebeat: '12X', crimetype: 'BURG - RESIDENTIAL', cnt: '10' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(2);
      expect(obs[0].category).toBe('property');
      expect(obs[1].category).toBe('property');
    });

    it('maps BURG-COMMERCIAL and BURG - COMMERCIAL to property', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'BURG-COMMERCIAL', cnt: '10' },
        { policebeat: '12X', crimetype: 'BURG - COMMERCIAL', cnt: '10' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(2);
      expect(obs[0].category).toBe('property');
      expect(obs[1].category).toBe('property');
    });
  });

  describe('unmapped categories', () => {
    it('skips rows with unmapped crime types like "OTHER"', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'OTHER', cnt: '100' },
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '50' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].category).toBe('violent');
      expect(obs[0].rawCategory).toBe('ROBBERY');
    });

    it('skips "WARRANT" as unmapped', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'WARRANT', cnt: '40' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(0);
    });

    it('skips all unmapped types in a batch', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'OTHER', cnt: '100' },
        { policebeat: '12X', crimetype: 'WARRANT', cnt: '40' },
        { policebeat: '12X', crimetype: 'TRAFFIC', cnt: '200' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(0);
    });
  });

  describe('empty/null policebeat', () => {
    it('skips rows with empty policebeat', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '', crimetype: 'ROBBERY', cnt: '10' },
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '20' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].geoAreaId).toBe('beat:12x');
    });

    it('skips rows with null-like policebeat', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: undefined as unknown as string, crimetype: 'ROBBERY', cnt: '10' },
        { policebeat: '17Y', crimetype: 'ASSAULT', cnt: '15' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].geoAreaId).toBe('beat:17y');
    });

    it('skips rows with empty crimetype', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: '', cnt: '10' },
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '20' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toHaveLength(1);
      expect(obs[0].rawCategory).toBe('ROBBERY');
    });
  });

  describe('source metadata', () => {
    it('all observations have sourceId "oakland"', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '50' },
        { policebeat: '17Y', crimetype: 'NARCOTICS', cnt: '30' },
        { policebeat: '35X', crimetype: 'PETTY THEFT', cnt: '100' },
      ]);

      const obs = await oaklandIngester.fetch();
      for (const o of obs) {
        expect(o.sourceId).toBe('oakland');
      }
    });

    it('preserves rawCategory from input', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '50' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].rawCategory).toBe('ROBBERY');
    });

    it('parses incidentCount from string cnt', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '50' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].incidentCount).toBe(50);
      expect(typeof obs[0].incidentCount).toBe('number');
    });

    it('defaults incidentCount to 0 for non-numeric cnt', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: 'bad' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].incidentCount).toBe(0);
    });

    it('sets periodStart and periodEnd as date strings', async () => {
      mockFetchSocrata.mockResolvedValueOnce([
        { policebeat: '12X', crimetype: 'ROBBERY', cnt: '10' },
      ]);

      const obs = await oaklandIngester.fetch();
      expect(obs[0].periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(obs[0].periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('Socrata call parameters', () => {
    it('calls fetchSocrata with correct domain and dataset', async () => {
      mockFetchSocrata.mockResolvedValueOnce([]);

      await oaklandIngester.fetch();

      expect(mockFetchSocrata).toHaveBeenCalledTimes(1);
      const args = mockFetchSocrata.mock.calls[0][0];
      expect(args.domain).toBe('data.oaklandca.gov');
      expect(args.datasetId).toBe('ppgh-7dqv');
      expect(args.limit).toBe(50000);
    });

    it('groups by policebeat and crimetype', async () => {
      mockFetchSocrata.mockResolvedValueOnce([]);

      await oaklandIngester.fetch();

      const args = mockFetchSocrata.mock.calls[0][0];
      expect(args.group).toBe('policebeat, crimetype');
      expect(args.select).toContain('policebeat');
      expect(args.select).toContain('crimetype');
      expect(args.select).toContain('count(*)');
    });
  });

  describe('empty responses', () => {
    it('returns empty array when Socrata returns no rows', async () => {
      mockFetchSocrata.mockResolvedValueOnce([]);

      const obs = await oaklandIngester.fetch();
      expect(obs).toEqual([]);
    });
  });
});
