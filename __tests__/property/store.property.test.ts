import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { useAppStore, selectFilteredApartments } from '@/lib/store';
import type { Apartment, BartStation } from '@/lib/types';

function makeApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    id: 1,
    name: 'Test',
    address: '123 Main',
    lat: 37.8,
    lng: -122.3,
    websiteUrl: '',
    nearestStationId: 'MONT',
    walkMinToBart: 5,
    hasInUnitWd: false,
    hasDishwasher: false,
    hasParking: false,
    parkingType: null,
    hasGym: false,
    hasPool: false,
    petFriendly: false,
    scrapeStatus: 'ok',
    lastScrapedAt: null,
    minPrice: 2500,
    maxPrice: 3500,
    bedroomTypes: [0, 1, 2],
    ...overrides,
  };
}

function makeStation(overrides: Partial<BartStation> = {}): BartStation {
  return {
    id: 'MONT',
    name: 'Montgomery',
    lat: 37.79,
    lng: -122.40,
    lineColors: ['yellow'],
    travelTimeMin: 10,
    fareCents: 200,
    monthlyCommuteCost: 80,
    safetyScore: 7,
    ...overrides,
  };
}

describe('Store property-based tests', () => {
  beforeEach(() => {
    useAppStore.setState({
      stations: [makeStation()],
      apartments: [
        makeApartment({ id: 1, minPrice: 1500 }),
        makeApartment({ id: 2, minPrice: 2500 }),
        makeApartment({ id: 3, minPrice: 3500 }),
        makeApartment({ id: 4, minPrice: 4500 }),
      ],
      filters: {
        priceRange: [1000, 5000],
        bedrooms: [],
        inUnitWd: false,
        dishwasher: false,
        parking: false,
        gym: false,
        pool: false,
        petFriendly: false,
        maxCommuteMin: 60,
        minSafetyScore: 1,
      },
      selectedApartmentId: null,
      selectedStationId: null,
      safetyOverlayVisible: false,
      viewport: { latitude: 37.7749, longitude: -122.2194, zoom: 10 },
    });
  });

  it('any price range [a, b] where a <= b produces valid filter results (no crash)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (a, b) => {
          const low = Math.min(a, b);
          const high = Math.max(a, b);
          useAppStore.getState().setPriceRange([low, high]);
          const result = selectFilteredApartments(useAppStore.getState());
          // Result is always a valid array
          expect(Array.isArray(result)).toBe(true);
          // Every returned apartment has minPrice within range (or null)
          for (const apt of result) {
            if (apt.minPrice != null) {
              expect(apt.minPrice).toBeGreaterThanOrEqual(low);
              expect(apt.minPrice).toBeLessThanOrEqual(high);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('commute filter with any value 10-60 never crashes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 60 }),
        (commute) => {
          useAppStore.getState().setMaxCommute(commute);
          const result = selectFilteredApartments(useAppStore.getState());
          expect(Array.isArray(result)).toBe(true);
          // Result length is between 0 and total apartments
          expect(result.length).toBeGreaterThanOrEqual(0);
          expect(result.length).toBeLessThanOrEqual(4);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('resetFilters always returns to default state regardless of prior mutations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 4 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 10, max: 60 }),
        fc.integer({ min: 1, max: 10 }),
        (priceA, priceB, bedrooms, wd, gym, pet, commute, safety) => {
          const store = useAppStore.getState();
          store.setPriceRange([Math.min(priceA, priceB), Math.max(priceA, priceB)]);
          for (const b of bedrooms) store.toggleBedroom(b);
          if (wd) store.toggleAmenity('inUnitWd');
          if (gym) store.toggleAmenity('gym');
          if (pet) store.toggleAmenity('petFriendly');
          store.setMaxCommute(commute);
          store.setMinSafety(safety);

          // Reset
          useAppStore.getState().resetFilters();

          const { filters } = useAppStore.getState();
          expect(filters.priceRange).toEqual([1000, 5000]);
          expect(filters.bedrooms).toEqual([]);
          expect(filters.inUnitWd).toBe(false);
          expect(filters.dishwasher).toBe(false);
          expect(filters.parking).toBe(false);
          expect(filters.gym).toBe(false);
          expect(filters.pool).toBe(false);
          expect(filters.petFriendly).toBe(false);
          expect(filters.maxCommuteMin).toBe(60);
          expect(filters.minSafetyScore).toBe(1);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('safety filter with any value 1-10 never crashes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (safety) => {
          useAppStore.getState().setMinSafety(safety);
          const result = selectFilteredApartments(useAppStore.getState());
          expect(Array.isArray(result)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('toggling any bedroom value maintains valid filter state', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 10 }),
        (bedroomToggles) => {
          // Reset bedrooms
          useAppStore.setState((s) => ({
            filters: { ...s.filters, bedrooms: [] },
          }));

          for (const b of bedroomToggles) {
            useAppStore.getState().toggleBedroom(b);
          }

          const { bedrooms } = useAppStore.getState().filters;
          // No duplicates
          const unique = new Set(bedrooms);
          expect(unique.size).toBe(bedrooms.length);

          // All values are valid bedroom numbers
          for (const b of bedrooms) {
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(3);
          }

          // Selector still works
          const result = selectFilteredApartments(useAppStore.getState());
          expect(Array.isArray(result)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('filtered results are always a subset of all apartments', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 5000 }),
        fc.integer({ min: 1000, max: 5000 }),
        fc.integer({ min: 10, max: 60 }),
        (priceA, priceB, commute) => {
          const low = Math.min(priceA, priceB);
          const high = Math.max(priceA, priceB);
          useAppStore.getState().setPriceRange([low, high]);
          useAppStore.getState().setMaxCommute(commute);

          const all = useAppStore.getState().apartments;
          const filtered = selectFilteredApartments(useAppStore.getState());

          expect(filtered.length).toBeLessThanOrEqual(all.length);
          for (const apt of filtered) {
            expect(all.find((a) => a.id === apt.id)).toBeDefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
