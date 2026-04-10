import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, selectFilteredApartments } from '@/lib/store';
import type { Apartment, BartStation } from '@/lib/types';

function makeApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    id: 1,
    name: 'Test Apt',
    address: '123 Main St',
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
    bedroomTypes: [1, 2],
    ...overrides,
  };
}

function makeStation(overrides: Partial<BartStation> = {}): BartStation {
  return {
    id: 'MONT',
    name: 'Montgomery St.',
    lat: 37.7894,
    lng: -122.4013,
    lineColors: ['yellow'],
    travelTimeMin: 0,
    fareCents: 0,
    monthlyCommuteCost: 0,
    safetyScore: 8,
    ...overrides,
  };
}

describe('Zustand store', () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useAppStore.setState({
      stations: [],
      apartments: [],
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

  describe('default state', () => {
    it('has empty stations and apartments arrays', () => {
      const state = useAppStore.getState();
      expect(state.stations).toEqual([]);
      expect(state.apartments).toEqual([]);
      expect(state.stations).toHaveLength(0);
      expect(state.apartments).toHaveLength(0);
      expect(Array.isArray(state.stations)).toBe(true);
      expect(Array.isArray(state.apartments)).toBe(true);
    });

    it('has default filter values', () => {
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
    });

    it('has no selection', () => {
      const state = useAppStore.getState();
      expect(state.selectedApartmentId).toBeNull();
      expect(state.selectedStationId).toBeNull();
    });

    it('has safety overlay hidden by default', () => {
      expect(useAppStore.getState().safetyOverlayVisible).toBe(false);
    });

    it('has default viewport centered on Bay Area with negative longitude', () => {
      const { viewport } = useAppStore.getState();
      expect(viewport.latitude).toBeCloseTo(37.7749);
      expect(viewport.longitude).toBeCloseTo(-122.2194);
      expect(viewport.longitude).toBeLessThan(0);
      expect(viewport.zoom).toBe(10);
      // Verify viewport has all expected properties
      expect(viewport).toHaveProperty('latitude');
      expect(viewport).toHaveProperty('longitude');
      expect(viewport).toHaveProperty('zoom');
    });

    // Kill: viewport {} mutant and longitude negation mutant
    it('has viewport with exactly 3 keys and negative longitude', () => {
      const { viewport } = useAppStore.getState();
      expect(Object.keys(viewport)).toHaveLength(3);
      expect(viewport.latitude).toBe(37.7749);
      expect(viewport.longitude).toBe(-122.2194);
      expect(viewport.zoom).toBe(10);
    });

    // Kill: safetyOverlayVisible false → true mutant
    it('has safetyOverlayVisible strictly false', () => {
      expect(useAppStore.getState().safetyOverlayVisible).toStrictEqual(false);
    });

    // Kill: filteredApartments [] → ["Stryker was here"] mutant
    it('has filteredApartments as empty array of correct type', () => {
      const fa = useAppStore.getState().filteredApartments;
      expect(fa).toEqual([]);
      expect(fa).toHaveLength(0);
    });

    // Kill: stations [] → ["Stryker was here"] mutant
    it('has stations as empty array of correct type', () => {
      const s = useAppStore.getState().stations;
      expect(s).toEqual([]);
      expect(s).toHaveLength(0);
    });
  });

  describe('data actions', () => {
    it('setStations updates stations array', () => {
      const stations = [makeStation()];
      useAppStore.getState().setStations(stations);
      expect(useAppStore.getState().stations).toEqual(stations);
    });

    it('setApartments updates apartments array', () => {
      const apartments = [makeApartment()];
      useAppStore.getState().setApartments(apartments);
      expect(useAppStore.getState().apartments).toEqual(apartments);
    });
  });

  describe('filter actions', () => {
    it('setPriceRange updates price range', () => {
      useAppStore.getState().setPriceRange([2000, 4000]);
      expect(useAppStore.getState().filters.priceRange).toEqual([2000, 4000]);
    });

    it('toggleBedroom adds a bedroom when not present', () => {
      useAppStore.getState().toggleBedroom(1);
      expect(useAppStore.getState().filters.bedrooms).toEqual([1]);
    });

    it('toggleBedroom removes a bedroom when already present', () => {
      useAppStore.getState().toggleBedroom(1);
      useAppStore.getState().toggleBedroom(1);
      expect(useAppStore.getState().filters.bedrooms).toEqual([]);
    });

    it('toggleBedroom removes only the specified bedroom, keeping others', () => {
      useAppStore.getState().toggleBedroom(0);
      useAppStore.getState().toggleBedroom(1);
      useAppStore.getState().toggleBedroom(2);
      // Remove bedroom 1, should keep 0 and 2
      useAppStore.getState().toggleBedroom(1);
      const bedrooms = useAppStore.getState().filters.bedrooms;
      expect(bedrooms).toEqual([0, 2]);
      expect(bedrooms).toHaveLength(2);
      expect(bedrooms).toContain(0);
      expect(bedrooms).toContain(2);
      expect(bedrooms).not.toContain(1);
    });

    it('toggleBedroom supports multiple bedroom types', () => {
      useAppStore.getState().toggleBedroom(0);
      useAppStore.getState().toggleBedroom(2);
      expect(useAppStore.getState().filters.bedrooms).toEqual([0, 2]);
    });

    it('toggleAmenity toggles boolean amenity filters', () => {
      const store = useAppStore.getState();
      store.toggleAmenity('inUnitWd');
      expect(useAppStore.getState().filters.inUnitWd).toBe(true);
      useAppStore.getState().toggleAmenity('inUnitWd');
      expect(useAppStore.getState().filters.inUnitWd).toBe(false);
    });

    it('toggleAmenity works for all amenity keys', () => {
      const keys = ['inUnitWd', 'dishwasher', 'parking', 'gym', 'pool', 'petFriendly'] as const;
      for (const key of keys) {
        useAppStore.getState().toggleAmenity(key);
        expect(useAppStore.getState().filters[key]).toBe(true);
      }
    });

    it('setMaxCommute updates max commute minutes', () => {
      useAppStore.getState().setMaxCommute(30);
      expect(useAppStore.getState().filters.maxCommuteMin).toBe(30);
    });

    it('setMinSafety updates minimum safety score', () => {
      useAppStore.getState().setMinSafety(5);
      expect(useAppStore.getState().filters.minSafetyScore).toBe(5);
    });

    it('resetFilters restores all defaults', () => {
      // Modify multiple filters
      const store = useAppStore.getState();
      store.setPriceRange([2000, 3000]);
      store.toggleBedroom(1);
      store.toggleAmenity('gym');
      store.setMaxCommute(20);
      store.setMinSafety(7);

      // Reset
      useAppStore.getState().resetFilters();

      const { filters } = useAppStore.getState();
      expect(filters.priceRange).toEqual([1000, 5000]);
      expect(filters.bedrooms).toEqual([]);
      expect(filters.gym).toBe(false);
      expect(filters.maxCommuteMin).toBe(60);
      expect(filters.minSafetyScore).toBe(1);
    });

    it('setFilter sets individual filter keys', () => {
      useAppStore.getState().setFilter('parking', true);
      expect(useAppStore.getState().filters.parking).toBe(true);
    });
  });

  describe('selection actions', () => {
    it('selectApartment sets selected apartment id', () => {
      useAppStore.getState().selectApartment(42);
      expect(useAppStore.getState().selectedApartmentId).toBe(42);
    });

    it('selectApartment can deselect with null', () => {
      useAppStore.getState().selectApartment(42);
      useAppStore.getState().selectApartment(null);
      expect(useAppStore.getState().selectedApartmentId).toBeNull();
    });

    it('selectStation sets selected station id', () => {
      useAppStore.getState().selectStation('DALY');
      expect(useAppStore.getState().selectedStationId).toBe('DALY');
    });
  });

  describe('map actions', () => {
    it('toggleSafetyOverlay toggles visibility', () => {
      expect(useAppStore.getState().safetyOverlayVisible).toBe(false);
      useAppStore.getState().toggleSafetyOverlay();
      expect(useAppStore.getState().safetyOverlayVisible).toBe(true);
      useAppStore.getState().toggleSafetyOverlay();
      expect(useAppStore.getState().safetyOverlayVisible).toBe(false);
    });

    it('setViewport updates viewport', () => {
      useAppStore.getState().setViewport({ latitude: 38.0, longitude: -121.0, zoom: 12 });
      const { viewport } = useAppStore.getState();
      expect(viewport.latitude).toBe(38.0);
      expect(viewport.longitude).toBe(-121.0);
      expect(viewport.zoom).toBe(12);
    });
  });
});

describe('selectFilteredApartments', () => {
  beforeEach(() => {
    const stations = [
      makeStation({ id: 'MONT', travelTimeMin: 0, safetyScore: 8 }),
      makeStation({ id: 'DALY', name: 'Daly City', travelTimeMin: 20, safetyScore: 6 }),
      makeStation({ id: 'RICH', name: 'Richmond', travelTimeMin: 40, safetyScore: 3 }),
    ];
    const apartments = [
      makeApartment({ id: 1, minPrice: 2000, bedroomTypes: [1], nearestStationId: 'MONT', walkMinToBart: 5, hasGym: true }),
      makeApartment({ id: 2, minPrice: 3500, bedroomTypes: [2], nearestStationId: 'DALY', walkMinToBart: 10, hasPool: true }),
      makeApartment({ id: 3, minPrice: 1500, bedroomTypes: [0], nearestStationId: 'RICH', walkMinToBart: 8, petFriendly: true }),
    ];
    const filters = {
      priceRange: [1000, 5000] as [number, number],
      bedrooms: [] as number[],
      inUnitWd: false,
      dishwasher: false,
      parking: false,
      gym: false,
      pool: false,
      petFriendly: false,
      maxCommuteMin: 60,
      minSafetyScore: 1,
    };
    useAppStore.setState({
      stations,
      apartments,
      filters,
      filteredApartments: apartments,
    });
  });

  it('returns all apartments when no filters active', () => {
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(3);
  });

  it('filters by price range', () => {
    useAppStore.getState().setPriceRange([2000, 3000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('excludes apartments below price min', () => {
    useAppStore.getState().setPriceRange([2500, 5000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result.find((a) => a.id === 3)).toBeUndefined(); // 1500 < 2500
  });

  it('excludes apartments above price max', () => {
    useAppStore.getState().setPriceRange([1000, 2000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result.find((a) => a.id === 2)).toBeUndefined(); // 3500 > 2000
  });

  it('filters by bedroom type', () => {
    useAppStore.getState().toggleBedroom(0); // Studio
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it('filters by multiple bedroom types', () => {
    useAppStore.getState().toggleBedroom(1);
    useAppStore.getState().toggleBedroom(2);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id).sort()).toEqual([1, 2]);
  });

  it('filters by amenity (gym)', () => {
    useAppStore.getState().toggleAmenity('gym');
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('filters by amenity (pool)', () => {
    useAppStore.getState().toggleAmenity('pool');
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it('filters by amenity (petFriendly)', () => {
    useAppStore.getState().toggleAmenity('petFriendly');
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it('commute filter includes walkMinToBart in total commute', () => {
    // MONT: travelTime=0, walk=5 → total=5 → pass 30
    // DALY: travelTime=20, walk=10 → total=30 → pass 30
    // RICH: travelTime=40, walk=8 → total=48 → fail 30
    useAppStore.getState().setMaxCommute(30);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id).sort()).toEqual([1, 2]);
  });

  it('commute filter at 60 (no limit) includes all apartments', () => {
    useAppStore.getState().setMaxCommute(60);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(3);
  });

  it('commute filter handles apartments without walkMinToBart (defaults to 0)', () => {
    useAppStore.setState({
      apartments: [
        makeApartment({ id: 10, nearestStationId: 'DALY', walkMinToBart: null }),
      ],
    });
    // DALY travelTime=20, walkMinToBart=null → totalCommute = 20 + 0 = 20
    useAppStore.getState().setMaxCommute(25);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  it('safety filter excludes apartments near unsafe stations', () => {
    useAppStore.getState().setMinSafety(5);
    const result = selectFilteredApartments(useAppStore.getState());
    // MONT=8 pass, DALY=6 pass, RICH=3 fail
    expect(result).toHaveLength(2);
    expect(result.find((a) => a.id === 3)).toBeUndefined();
  });

  it('safety filter at 1 (no filter) includes all apartments', () => {
    useAppStore.getState().setMinSafety(1);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(3);
  });

  it('combined filters work together', () => {
    useAppStore.getState().setPriceRange([1000, 3000]);
    useAppStore.getState().setMaxCommute(30);
    useAppStore.getState().setMinSafety(5);
    const result = selectFilteredApartments(useAppStore.getState());
    // id=1: price=2000 ok, commute=5 ok, safety=8 ok → pass
    // id=2: price=3500 fail
    // id=3: price=1500 ok, commute=48 fail
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('apartments without minPrice pass price filter', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 99, minPrice: null })],
    });
    useAppStore.getState().setPriceRange([2000, 3000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  it('apartments without nearestStationId skip commute and safety filters', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 50, nearestStationId: null })],
    });
    useAppStore.getState().setMaxCommute(10);
    useAppStore.getState().setMinSafety(9);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Boundary tests for price filter — kills mutations that change < to <= or > to >=
  it('includes apartment at exact price min boundary', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 2000 })],
    });
    useAppStore.getState().setPriceRange([2000, 5000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  it('includes apartment at exact price max boundary', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 5000 })],
    });
    useAppStore.getState().setPriceRange([1000, 5000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  it('excludes apartment one dollar below price min', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 1999 })],
    });
    useAppStore.getState().setPriceRange([2000, 5000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  it('excludes apartment one dollar above price max', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 5001 })],
    });
    useAppStore.getState().setPriceRange([1000, 5000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  // Tests for commute boundary at exactly 60
  it('commute filter at exactly maxCommuteMin boundary includes apartment', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'DALY', walkMinToBart: 10 })],
    });
    // DALY travelTimeMin=20, walk=10, total=30 — exactly at limit
    useAppStore.getState().setMaxCommute(30);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  it('commute filter at exactly maxCommuteMin + 1 excludes apartment', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'DALY', walkMinToBart: 11 })],
    });
    // DALY travelTimeMin=20, walk=11, total=31 — over 30 limit
    useAppStore.getState().setMaxCommute(30);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  // Test commute filter at 59 (just under the bypass threshold)
  it('commute filter at 59 still applies filtering', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'RICH', walkMinToBart: 20 })],
    });
    // RICH travelTimeMin=40, walk=20, total=60 — over 59 limit
    useAppStore.getState().setMaxCommute(59);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  // Commute=60 is the bypass — must NOT apply commute filtering even for long commutes
  it('commute filter at exactly 60 bypasses filtering for long commutes', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'RICH', walkMinToBart: 100 })],
    });
    // RICH travelTimeMin=40, walk=100, total=140 — but 60 means no limit
    useAppStore.getState().setMaxCommute(60);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Test safety boundary at exactly minSafetyScore
  it('safety filter includes station at exact safety score boundary', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'DALY' })],
    });
    // DALY safetyScore=6, filter at 6 — should pass (not less than 6)
    useAppStore.getState().setMinSafety(6);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  it('safety filter excludes station one below safety threshold', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'DALY' })],
    });
    // DALY safetyScore=6, filter at 7 — should fail (6 < 7)
    useAppStore.getState().setMinSafety(7);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  // Test safety filter at 2 (just above the bypass threshold of 1)
  it('safety filter at 2 applies filtering', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'RICH' })],
    });
    // RICH safetyScore=3, filter at 2 — should pass (3 >= 2)
    useAppStore.getState().setMinSafety(2);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Safety=1 is the bypass — must NOT apply safety filtering even for unsafe stations
  it('safety filter at exactly 1 bypasses filtering for all stations', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'UNSAFE', safetyScore: 1 })],
      apartments: [makeApartment({ id: 10, nearestStationId: 'UNSAFE' })],
    });
    useAppStore.getState().setMinSafety(1);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Test station without travelTimeMin (null) - commute filter should pass
  it('commute filter passes when station has null travelTimeMin', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'NULL_TRAVEL', travelTimeMin: null })],
      apartments: [makeApartment({ id: 10, nearestStationId: 'NULL_TRAVEL', walkMinToBart: 5 })],
    });
    useAppStore.getState().setMaxCommute(10);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Test station without safetyScore (null) - safety filter should pass
  it('safety filter passes when station has null safetyScore', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'NULL_SAFETY', safetyScore: null })],
      apartments: [makeApartment({ id: 10, nearestStationId: 'NULL_SAFETY' })],
    });
    useAppStore.getState().setMinSafety(9);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Test that station not found in stationMap skips commute filter
  it('commute filter passes when station not found in stationMap', () => {
    useAppStore.setState({
      stations: [], // empty — no station found
      apartments: [makeApartment({ id: 10, nearestStationId: 'UNKNOWN', walkMinToBart: 100 })],
    });
    useAppStore.getState().setMaxCommute(10);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Test inUnitWd and dishwasher amenity filters directly
  it('filters by amenity (inUnitWd)', () => {
    useAppStore.setState({
      apartments: [
        makeApartment({ id: 1, hasInUnitWd: true }),
        makeApartment({ id: 2, hasInUnitWd: false }),
      ],
    });
    useAppStore.getState().toggleAmenity('inUnitWd');
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('filters by amenity (dishwasher)', () => {
    useAppStore.setState({
      apartments: [
        makeApartment({ id: 1, hasDishwasher: true }),
        makeApartment({ id: 2, hasDishwasher: false }),
      ],
    });
    useAppStore.getState().toggleAmenity('dishwasher');
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('filters by amenity (parking)', () => {
    useAppStore.setState({
      apartments: [
        makeApartment({ id: 1, hasParking: true }),
        makeApartment({ id: 2, hasParking: false }),
      ],
    });
    useAppStore.getState().toggleAmenity('parking');
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  // Test setBedrooms action
  it('setBedrooms sets bedrooms directly', () => {
    useAppStore.getState().setBedrooms([0, 1, 3]);
    expect(useAppStore.getState().filters.bedrooms).toEqual([0, 1, 3]);
  });

  // Test setFilter for various keys
  it('setFilter sets maxCommuteMin', () => {
    useAppStore.getState().setFilter('maxCommuteMin', 45);
    expect(useAppStore.getState().filters.maxCommuteMin).toBe(45);
  });

  it('setFilter sets minSafetyScore', () => {
    useAppStore.getState().setFilter('minSafetyScore', 8);
    expect(useAppStore.getState().filters.minSafetyScore).toBe(8);
  });

  it('setFilter sets priceRange', () => {
    useAppStore.getState().setFilter('priceRange', [1500, 3500]);
    expect(useAppStore.getState().filters.priceRange).toEqual([1500, 3500]);
  });

  // Test bedroom filter with apartment that has multiple bedroom types matching
  it('bedroom filter matches when apartment has overlapping bedroom types', () => {
    useAppStore.setState({
      apartments: [
        makeApartment({ id: 1, bedroomTypes: [1, 2, 3] }),
        makeApartment({ id: 2, bedroomTypes: [0] }),
      ],
    });
    useAppStore.getState().toggleBedroom(2);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  // Test bedroom filter with no overlap
  it('bedroom filter excludes apartment with no matching types', () => {
    useAppStore.setState({
      apartments: [
        makeApartment({ id: 1, bedroomTypes: [3] }),
      ],
    });
    useAppStore.getState().toggleBedroom(2);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  // --- Mutation-killing tests for store.ts ---

  // Kill: safety `> 1` → `>= 1` (line 52)
  // When minSafetyScore=1, the guard should be FALSE (bypass safety filter).
  // A station with safetyScore=0 should PASS when minSafetyScore=1.
  it('safety filter at exactly 1 does not exclude station with safetyScore 0', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'ZERO', safetyScore: 0 })],
      apartments: [makeApartment({ id: 1, nearestStationId: 'ZERO' })],
    });
    useAppStore.getState().setMinSafety(1);
    const result = selectFilteredApartments(useAppStore.getState());
    // minSafetyScore=1 means "no filter", so even safetyScore=0 should pass
    expect(result).toHaveLength(1);
  });

  // Kill: safety `&& apt.nearestStationId` → `|| apt.nearestStationId`
  // When minSafetyScore > 1 but apt has NO nearestStationId, should pass
  it('safety filter skips apartments without nearestStationId even when score > 1', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'SAFE', safetyScore: 10 })],
      apartments: [makeApartment({ id: 1, nearestStationId: null })],
    });
    useAppStore.getState().setMinSafety(9);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Another test: safety `true` mutant on outer conditional (line 52: if (true))
  // When minSafetyScore=1 and apt HAS a nearestStationId with safetyScore < 1,
  // it should STILL pass because the guard `minSafetyScore > 1` is false
  it('safety filter is completely bypassed when minSafetyScore=1 regardless of station safety', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'BAD', safetyScore: 0 })],
      apartments: [
        makeApartment({ id: 1, nearestStationId: 'BAD' }),
        makeApartment({ id: 2, nearestStationId: 'BAD' }),
      ],
    });
    useAppStore.getState().setMinSafety(1);
    const result = selectFilteredApartments(useAppStore.getState());
    // Both should pass since minSafetyScore=1 means no filtering
    expect(result).toHaveLength(2);
  });

  // Kill: optional chaining removed on station?.safetyScore (line 54)
  // This only matters when station is undefined (not found in stationMap)
  // AND minSafetyScore > 1 AND apt has a nearestStationId
  it('safety filter passes when station not found in stationMap', () => {
    useAppStore.setState({
      stations: [], // No stations in map
      apartments: [makeApartment({ id: 1, nearestStationId: 'MISSING' })],
    });
    useAppStore.getState().setMinSafety(5);
    const result = selectFilteredApartments(useAppStore.getState());
    // Station not found → station is undefined → station?.safetyScore is undefined → skip filter
    expect(result).toHaveLength(1);
  });
});
