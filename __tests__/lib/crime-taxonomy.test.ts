import { describe, it, expect } from 'vitest';
import {
  mapCategory,
  SOURCE_CATEGORY_MAPS,
  DEFAULT_WEIGHTS,
  WEIGHT_PRESETS,
  type CrimeCategory,
} from '@/lib/crime-taxonomy';

const VALID_CATEGORIES: CrimeCategory[] = ['violent', 'property', 'vehicle', 'quality_of_life'];

describe('mapCategory', () => {
  it('returns correct category for exact match (datasf)', () => {
    expect(mapCategory('datasf', 'Assault')).toBe('violent');
    expect(mapCategory('datasf', 'Larceny Theft')).toBe('property');
    expect(mapCategory('datasf', 'Motor Vehicle Theft')).toBe('vehicle');
    expect(mapCategory('datasf', 'Drug Offense')).toBe('quality_of_life');
  });

  it('returns correct category for case-insensitive match (oakland)', () => {
    expect(mapCategory('oakland', 'robbery')).toBe('violent');
    expect(mapCategory('oakland', 'petty theft')).toBe('property');
    expect(mapCategory('oakland', 'burg-auto')).toBe('vehicle');
    expect(mapCategory('oakland', 'narcotics')).toBe('quality_of_life');
  });

  it('returns null for unknown source', () => {
    expect(mapCategory('nonexistent', 'Assault')).toBeNull();
  });

  it('returns null for unknown category', () => {
    expect(mapCategory('datasf', 'Jaywalking')).toBeNull();
  });

  it('returns null for empty string category', () => {
    expect(mapCategory('datasf', '')).toBeNull();
  });

  it('handles mixed-case input against title-case map keys (datasf)', () => {
    expect(mapCategory('datasf', 'assault')).toBe('violent');
    expect(mapCategory('datasf', 'ASSAULT')).toBe('violent');
    expect(mapCategory('datasf', 'larceny theft')).toBe('property');
  });

  it('handles mixed-case input against uppercase map keys (oakland)', () => {
    expect(mapCategory('oakland', 'Assault')).toBe('violent');
    expect(mapCategory('oakland', 'assault')).toBe('violent');
  });
});

describe('source mapping completeness', () => {
  const expectedSources = ['ca_doj', 'datasf', 'oakland', 'santa_clara', 'marin', 'fbi'];

  it('has mappings for all expected sources', () => {
    for (const source of expectedSources) {
      expect(SOURCE_CATEGORY_MAPS).toHaveProperty(source);
    }
  });

  it('all mapped values are valid CrimeCategory values', () => {
    for (const [sourceId, map] of Object.entries(SOURCE_CATEGORY_MAPS)) {
      for (const [rawCat, { category }] of Object.entries(map)) {
        expect(
          VALID_CATEGORIES,
          `${sourceId} -> '${rawCat}' maps to invalid category '${category}'`
        ).toContain(category);
      }
    }
  });

  describe('datasf key crime types', () => {
    it('maps Assault to violent', () => expect(mapCategory('datasf', 'Assault')).toBe('violent'));
    it('maps Larceny Theft to property', () => expect(mapCategory('datasf', 'Larceny Theft')).toBe('property'));
    it('maps Motor Vehicle Theft to vehicle', () => expect(mapCategory('datasf', 'Motor Vehicle Theft')).toBe('vehicle'));
    it('maps Drug Offense to quality_of_life', () => expect(mapCategory('datasf', 'Drug Offense')).toBe('quality_of_life'));
  });

  describe('oakland key crime types', () => {
    it('maps ROBBERY to violent', () => expect(mapCategory('oakland', 'ROBBERY')).toBe('violent'));
    it('maps PETTY THEFT to property', () => expect(mapCategory('oakland', 'PETTY THEFT')).toBe('property'));
    it('maps BURG-AUTO to vehicle', () => expect(mapCategory('oakland', 'BURG-AUTO')).toBe('vehicle'));
    it('maps NARCOTICS to quality_of_life', () => expect(mapCategory('oakland', 'NARCOTICS')).toBe('quality_of_life'));
  });

  describe('ca_doj key crime types', () => {
    it('maps Violent_sum to violent', () => expect(mapCategory('ca_doj', 'Violent_sum')).toBe('violent'));
    it('maps Property_sum to property', () => expect(mapCategory('ca_doj', 'Property_sum')).toBe('property'));
    it('maps VehicleTheft_sum to vehicle', () => expect(mapCategory('ca_doj', 'VehicleTheft_sum')).toBe('vehicle'));
  });
});

describe('Oakland spelling variants', () => {
  it('handles BURG-AUTO (no spaces)', () => {
    expect(mapCategory('oakland', 'BURG-AUTO')).toBe('vehicle');
  });

  it('handles BURG - AUTO (with spaces)', () => {
    expect(mapCategory('oakland', 'BURG - AUTO')).toBe('vehicle');
  });

  it('handles BURG-RESIDENTIAL and BURG - RESIDENTIAL', () => {
    expect(mapCategory('oakland', 'BURG-RESIDENTIAL')).toBe('property');
    expect(mapCategory('oakland', 'BURG - RESIDENTIAL')).toBe('property');
  });

  it('handles BURG-COMMERCIAL and BURG - COMMERCIAL', () => {
    expect(mapCategory('oakland', 'BURG-COMMERCIAL')).toBe('property');
    expect(mapCategory('oakland', 'BURG - COMMERCIAL')).toBe('property');
  });
});

describe('datasf spelling variants', () => {
  it('handles Weapons Offense', () => {
    expect(mapCategory('datasf', 'Weapons Offense')).toBe('violent');
  });

  it('handles Weapons Offence', () => {
    expect(mapCategory('datasf', 'Weapons Offence')).toBe('violent');
  });
});

describe('DEFAULT_WEIGHTS', () => {
  it('has all 4 required keys', () => {
    expect(DEFAULT_WEIGHTS).toHaveProperty('violent');
    expect(DEFAULT_WEIGHTS).toHaveProperty('property');
    expect(DEFAULT_WEIGHTS).toHaveProperty('vehicle');
    expect(DEFAULT_WEIGHTS).toHaveProperty('qualityOfLife');
  });

  it('all values are positive numbers', () => {
    for (const [key, value] of Object.entries(DEFAULT_WEIGHTS)) {
      expect(value, `${key} should be a positive number`).toBeGreaterThan(0);
      expect(typeof value).toBe('number');
    }
  });
});

describe('WEIGHT_PRESETS', () => {
  const expectedPresets = ['balanced', 'personal_safety', 'protect_my_stuff', 'night_owl'] as const;
  const requiredKeys = ['violent', 'property', 'vehicle', 'qualityOfLife'] as const;

  it('has all 4 preset keys', () => {
    for (const preset of expectedPresets) {
      expect(WEIGHT_PRESETS).toHaveProperty(preset);
    }
  });

  for (const preset of expectedPresets) {
    describe(`preset: ${preset}`, () => {
      it('has all 4 weight keys', () => {
        for (const key of requiredKeys) {
          expect(WEIGHT_PRESETS[preset]).toHaveProperty(key);
        }
      });

      it('all weight values are non-negative numbers', () => {
        for (const key of requiredKeys) {
          const value = WEIGHT_PRESETS[preset][key];
          expect(typeof value, `${preset}.${key} should be a number`).toBe('number');
          expect(value, `${preset}.${key} should be non-negative`).toBeGreaterThanOrEqual(0);
        }
      });
    });
  }
});
