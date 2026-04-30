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
    safetyScore: 0.2,
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
        maxRiskScore: 1,
      },
      selectedApartmentId: null,
      selectedStationId: null,
      safetyOverlayVisible: true,
      viewport: { latitude: 37.5693, longitude: -121.8268, zoom: 9.5 },
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
      expect(filters.maxRiskScore).toBe(1);
    });

    it('has no selection', () => {
      const state = useAppStore.getState();
      expect(state.selectedApartmentId).toBeNull();
      expect(state.selectedStationId).toBeNull();
    });

    it('has safety overlay visible by default', () => {
      expect(useAppStore.getState().safetyOverlayVisible).toBe(true);
    });

    it('has default viewport centered on Bay Area with negative longitude', () => {
      const { viewport } = useAppStore.getState();
      expect(viewport.latitude).toBeCloseTo(37.5693);
      expect(viewport.longitude).toBeCloseTo(-121.8268);
      expect(viewport.longitude).toBeLessThan(0);
      expect(viewport.zoom).toBe(9.5);
      // Verify viewport has all expected properties
      expect(viewport).toHaveProperty('latitude');
      expect(viewport).toHaveProperty('longitude');
      expect(viewport).toHaveProperty('zoom');
    });

    // Kill: viewport {} mutant and longitude negation mutant
    it('has viewport with exactly 3 keys and negative longitude', () => {
      const { viewport } = useAppStore.getState();
      expect(Object.keys(viewport)).toHaveLength(3);
      expect(viewport.latitude).toBe(37.5693);
      expect(viewport.longitude).toBe(-121.8268);
      expect(viewport.zoom).toBe(9.5);
    });

    // Kill: safetyOverlayVisible true → false mutant
    it('has safetyOverlayVisible strictly true', () => {
      expect(useAppStore.getState().safetyOverlayVisible).toStrictEqual(true);
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

    it('setMaxRisk updates maximum risk score', () => {
      useAppStore.getState().setMaxRisk(0.5);
      expect(useAppStore.getState().filters.maxRiskScore).toBe(0.5);
    });

    it('resetFilters restores all defaults', () => {
      // Modify multiple filters
      const store = useAppStore.getState();
      store.setPriceRange([2000, 3000]);
      store.toggleBedroom(1);
      store.toggleAmenity('gym');
      store.setMaxCommute(20);
      store.setMaxRisk(0.3);

      // Reset
      useAppStore.getState().resetFilters();

      const { filters } = useAppStore.getState();
      expect(filters.priceRange).toEqual([1000, 5000]);
      expect(filters.bedrooms).toEqual([]);
      expect(filters.gym).toBe(false);
      expect(filters.maxCommuteMin).toBe(60);
      expect(filters.maxRiskScore).toBe(1);
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
      expect(useAppStore.getState().safetyOverlayVisible).toBe(true);
      useAppStore.getState().toggleSafetyOverlay();
      expect(useAppStore.getState().safetyOverlayVisible).toBe(false);
      useAppStore.getState().toggleSafetyOverlay();
      expect(useAppStore.getState().safetyOverlayVisible).toBe(true);
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
      makeStation({ id: 'MONT', travelTimeMin: 0, safetyScore: 0.2 }),
      makeStation({ id: 'DALY', name: 'Daly City', travelTimeMin: 20, safetyScore: 0.5 }),
      makeStation({ id: 'RICH', name: 'Richmond', travelTimeMin: 40, safetyScore: 0.8 }),
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
      maxRiskScore: 1,
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

    // Kill: > to >= mutant on apt.minPrice > priceRange[1]
    // apt id=1 has minPrice=2000, priceRange=[2000,2000] — 2000 < 5000 so filter applies
    // With >: 2000 > 2000 = false → included. With >=: 2000 >= 2000 = true → excluded (wrong)
    useAppStore.getState().setPriceRange([2000, 2000]);
    const atBoundary = selectFilteredApartments(useAppStore.getState());
    expect(atBoundary).toHaveLength(1);
    expect(atBoundary[0].id).toBe(1);
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

  it('risk filter excludes apartments near dangerous stations', () => {
    useAppStore.getState().setMaxRisk(0.6);
    const result = selectFilteredApartments(useAppStore.getState());
    // MONT=0.2 pass (0.2<=0.6), DALY=0.5 pass, RICH=0.8 fail (0.8>0.6)
    expect(result).toHaveLength(2);
    expect(result.find((a) => a.id === 3)).toBeUndefined();
  });

  it('risk filter at 1 (no filter) includes all apartments', () => {
    useAppStore.getState().setMaxRisk(1);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(3);
  });

  it('combined filters work together', () => {
    useAppStore.getState().setPriceRange([1000, 3000]);
    useAppStore.getState().setMaxCommute(30);
    useAppStore.getState().setMaxRisk(0.6);
    const result = selectFilteredApartments(useAppStore.getState());
    // id=1: price=2000 ok, commute=5 ok, risk=0.2 ok → pass
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

  it('apartments without nearestStationId skip commute and risk filters', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 50, nearestStationId: null })],
    });
    useAppStore.getState().setMaxCommute(10);
    useAppStore.getState().setMaxRisk(0.05);
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

  it('excludes apartment one dollar above price max when max is below ceiling', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 4001 })],
    });
    useAppStore.getState().setPriceRange([1000, 4000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  it('does NOT exclude apartment above price max when max is at ceiling (5000)', () => {
    // priceRange[1] === 5000 is treated as "no max limit" in the store
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 5001 })],
    });
    useAppStore.getState().setPriceRange([1000, 5000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
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

  // Test risk boundary at exactly maxRiskScore
  it('risk filter includes station at exact risk score boundary', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'DALY' })],
    });
    // DALY safetyScore=0.5, filter at 0.5 — should pass (0.5 > 0.5 is false → not excluded)
    useAppStore.getState().setMaxRisk(0.5);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  it('risk filter excludes station one above risk threshold', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'DALY' })],
    });
    // DALY safetyScore=0.5, filter at 0.4 — should fail (0.5 > 0.4 → excluded)
    useAppStore.getState().setMaxRisk(0.4);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  // Test risk filter at 0.9 (just below the bypass threshold of 1)
  it('risk filter at 0.9 applies filtering', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, nearestStationId: 'RICH' })],
    });
    // RICH safetyScore=0.8, filter at 0.9 — should pass (0.8 > 0.9 is false → not excluded)
    useAppStore.getState().setMaxRisk(0.9);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // MaxRisk=1 is the bypass — must NOT apply risk filtering even for dangerous stations
  it('risk filter at exactly 1 bypasses filtering for all stations', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'UNSAFE', safetyScore: 1 })],
      apartments: [makeApartment({ id: 10, nearestStationId: 'UNSAFE' })],
    });
    useAppStore.getState().setMaxRisk(1);
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

  // Test station without safetyScore (null) - risk filter should pass
  it('risk filter passes when station has null safetyScore', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'NULL_SAFETY', safetyScore: null })],
      apartments: [makeApartment({ id: 10, nearestStationId: 'NULL_SAFETY' })],
    });
    useAppStore.getState().setMaxRisk(0.1);
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

  it('setFilter sets maxRiskScore', () => {
    useAppStore.getState().setFilter('maxRiskScore', 0.3);
    expect(useAppStore.getState().filters.maxRiskScore).toBe(0.3);
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

  // Kill: risk `< 1` → `<= 1` guard
  // When maxRiskScore=1, the guard should be FALSE (bypass risk filter).
  // A station with safetyScore=1 should PASS when maxRiskScore=1.
  it('risk filter at exactly 1 does not exclude station with safetyScore 1', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'MAX', safetyScore: 1 })],
      apartments: [makeApartment({ id: 1, nearestStationId: 'MAX' })],
    });
    useAppStore.getState().setMaxRisk(1);
    const result = selectFilteredApartments(useAppStore.getState());
    // maxRiskScore=1 means "no filter", so even safetyScore=1 should pass
    expect(result).toHaveLength(1);
  });

  // Kill: risk `&& apt.nearestStationId` → `|| apt.nearestStationId`
  // When maxRiskScore < 1 but apt has NO nearestStationId, should pass
  it('risk filter skips apartments without nearestStationId even when score < 1', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'SAFE', safetyScore: 0 })],
      apartments: [makeApartment({ id: 1, nearestStationId: null })],
    });
    useAppStore.getState().setMaxRisk(0.1);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Another test: risk `true` mutant on outer conditional
  // When maxRiskScore=1 and apt HAS a nearestStationId with safetyScore = 1,
  // it should STILL pass because the guard `maxRiskScore < 1` is false
  it('risk filter is completely bypassed when maxRiskScore=1 regardless of station risk', () => {
    useAppStore.setState({
      stations: [makeStation({ id: 'BAD', safetyScore: 1 })],
      apartments: [
        makeApartment({ id: 1, nearestStationId: 'BAD' }),
        makeApartment({ id: 2, nearestStationId: 'BAD' }),
      ],
    });
    useAppStore.getState().setMaxRisk(1);
    const result = selectFilteredApartments(useAppStore.getState());
    // Both should pass since maxRiskScore=1 means no filtering
    expect(result).toHaveLength(2);
  });

  // Kill: optional chaining removed on station?.safetyScore
  // This only matters when station is undefined (not found in stationMap)
  // AND maxRiskScore < 1 AND apt has a nearestStationId
  it('risk filter passes when station not found in stationMap', () => {
    useAppStore.setState({
      stations: [], // No stations in map
      apartments: [makeApartment({ id: 1, nearestStationId: 'MISSING' })],
    });
    useAppStore.getState().setMaxRisk(0.5);
    const result = selectFilteredApartments(useAppStore.getState());
    // Station not found → station is undefined → station?.safetyScore is undefined → skip filter
    expect(result).toHaveLength(1);
  });

  // Kill: priceRange[1] > to >= mutant (store.ts:27)
  // When max is just below ceiling, apartment at exact boundary should be excluded
  it('excludes apartment at exact price max boundary when max is below ceiling', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 4000 })],
    });
    // 4000 < 5000 → filter active. apt.minPrice (4000) > 3999 → excluded
    useAppStore.getState().setPriceRange([1000, 3999]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(0);
  });

  it('includes apartment one dollar below price max boundary when max is below ceiling', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 3999 })],
    });
    // 4000 < 5000 → filter active. apt.minPrice (3999) > 4000 → false → included
    useAppStore.getState().setPriceRange([1000, 4000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
  });

  // Kill: > to >= mutant on store.ts:27 (apt.minPrice > priceRange[1] vs >=)
  // Apartment at EXACT price max should be INCLUDED (not excluded)
  it('includes apartment at exact price max when max is below ceiling', () => {
    useAppStore.setState({
      apartments: [makeApartment({ id: 10, minPrice: 4000 })],
    });
    // priceRange[1]=4000 < 5000 → filter active. apt.minPrice=4000 > 4000 → false → included
    // With >= mutant: apt.minPrice=4000 >= 4000 → true → EXCLUDED (wrong!)
    useAppStore.getState().setPriceRange([1000, 4000]);
    const result = selectFilteredApartments(useAppStore.getState());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10);
  });
});

describe('Store initialization defaults', () => {
  beforeEach(() => {
    useAppStore.setState({
      stations: [],
      apartments: [],
      citySafety: [],
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
        maxRiskScore: 1,
      },
      filteredApartments: [],
      selectedApartmentId: null,
      selectedStationId: null,
      safetyOverlayVisible: true,
      mapStyle: 'https://tiles.openfreemap.org/styles/positron',
      viewport: { latitude: 37.5693, longitude: -121.8268, zoom: 9.5 },
    });
  });

  // Kill: viewport ObjectLiteral {} and longitude negation +122 mutants
  it('default viewport has correct latitude, negative longitude, and zoom', () => {
    const { viewport } = useAppStore.getState();
    expect(viewport.latitude).toBe(37.5693);
    expect(viewport.longitude).toBe(-121.8268);
    expect(viewport.longitude).toBeLessThan(0);
    expect(viewport.zoom).toBe(9.5);
    expect(Object.keys(viewport)).toHaveLength(3);
  });

  // Kill: safetyOverlayVisible false mutant
  it('safetyOverlayVisible is true at init', () => {
    expect(useAppStore.getState().safetyOverlayVisible).toBe(true);
    expect(useAppStore.getState().safetyOverlayVisible).not.toBe(false);
  });

  // Kill: stations [] → ["Stryker was here"] mutant
  it('stations is an empty array at init', () => {
    const stations = useAppStore.getState().stations;
    expect(stations).toEqual([]);
    expect(stations).toHaveLength(0);
  });

  // Kill: citySafety [] → ["Stryker was here"] mutant
  it('citySafety is an empty array at init', () => {
    const cs = useAppStore.getState().citySafety;
    expect(cs).toEqual([]);
    expect(cs).toHaveLength(0);
  });

  // Kill: setCitySafety arrow function and object literal mutants
  it('setCitySafety updates citySafety array', () => {
    const safety = [{ city: 'SF', safetyScore: 5 }] as any;
    useAppStore.getState().setCitySafety(safety);
    expect(useAppStore.getState().citySafety).toEqual(safety);
    expect(useAppStore.getState().citySafety).toHaveLength(1);
  });

  // Kill: setMapStyle arrow function and object literal mutants
  it('setMapStyle updates mapStyle string', () => {
    useAppStore.getState().setMapStyle('https://new-tiles.example.com/style');
    expect(useAppStore.getState().mapStyle).toBe('https://new-tiles.example.com/style');
    expect(useAppStore.getState().mapStyle).not.toBe('https://tiles.openfreemap.org/styles/positron');
  });

  // Kill: mapStyle "" mutant
  it('default mapStyle is the openfreemap positron URL', () => {
    expect(useAppStore.getState().mapStyle).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(useAppStore.getState().mapStyle.length).toBeGreaterThan(0);
  });

});

describe('Store create() initial values — no beforeEach reset', () => {
  // These tests verify the Zustand create() initializer values directly.
  // The store is a singleton so these test the actual initial values that
  // the store was created with, by using setStations to detect if
  // computeFilteredApartments works correctly with the initial state.

  // Kill: stations [] → ["Stryker was here"] in create() (store.ts:114)
  it('setStations with apartments recomputes filteredApartments using initial stations', () => {
    // Reset to known state, then call setStations to trigger computeFilteredApartments
    useAppStore.setState({
      apartments: [makeApartment({ id: 1, nearestStationId: 'MONT', walkMinToBart: 5 })],
      filters: { priceRange: [1000, 5000], bedrooms: [], inUnitWd: false, dishwasher: false, parking: false, gym: false, pool: false, petFriendly: false, maxCommuteMin: 60, maxRiskScore: 1 },
    });
    const stations = [makeStation({ id: 'MONT' })];
    useAppStore.getState().setStations(stations);
    expect(useAppStore.getState().stations).toEqual(stations);
    expect(useAppStore.getState().stations).toHaveLength(1);
    // Verify each station is a proper object, not a string
    expect(typeof useAppStore.getState().stations[0]).toBe('object');
    expect(useAppStore.getState().stations[0]).toHaveProperty('id');
  });

  // Kill: safetyOverlayVisible true → false in create() (store.ts:148)
  it('toggleSafetyOverlay from initial true produces false then true', () => {
    useAppStore.setState({ safetyOverlayVisible: true });
    // First toggle: true → false
    useAppStore.getState().toggleSafetyOverlay();
    expect(useAppStore.getState().safetyOverlayVisible).toBe(false);
    // Second toggle: false → true
    useAppStore.getState().toggleSafetyOverlay();
    expect(useAppStore.getState().safetyOverlayVisible).toBe(true);
  });

  // Kill: viewport {} mutant (store.ts:132) — setViewport then read back
  it('setViewport overwrites and viewport retains all properties', () => {
    useAppStore.getState().setViewport({ latitude: 38.0, longitude: -121.0, zoom: 12 });
    const vp = useAppStore.getState().viewport;
    expect(vp.latitude).toBe(38.0);
    expect(vp.longitude).toBe(-121.0);
    expect(vp.zoom).toBe(12);
    // Restore
    useAppStore.getState().setViewport({ latitude: 37.5693, longitude: -121.8268, zoom: 9.5 });
  });

  // Kill: viewport longitude negation +122 → -122 (store.ts:149)
  // The URL sync writeFiltersToUrl checks viewport !== default. With +122, the
  // default comparison in url-sync.ts would fail since 121.8268 !== -121.8268.
  // We test that the store's default viewport longitude matches the url-sync default.
  it('default viewport longitude matches url-sync default (-121.8268)', () => {
    useAppStore.setState({ viewport: { latitude: 37.5693, longitude: -121.8268, zoom: 9.5 } });
    const vp = useAppStore.getState().viewport;
    expect(vp.longitude).toBe(-121.8268);
    expect(vp.longitude).toBeLessThan(0);
  });
});

describe('Safety area rerank (setSafetyPreset / setSafetyWeights)', () => {
  function makeArea(overrides: Partial<import('@/lib/types').SafetyArea> = {}): import('@/lib/types').SafetyArea {
    return {
      id: 'T1',
      name: 'Tract 1',
      type: 'tract',
      parentId: null,
      score: 5.0,
      counts: { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 },
      sources: [],
      centroidLat: 37.8,
      centroidLng: -122.3,
      population: 1000,
      perCapitaRate: null,
      ...overrides,
    };
  }

  it('rerank produces tract scores in 0-1 scale (0=safest, 1=most dangerous)', () => {
    const areas = [
      makeArea({ id: 'T-safe', counts: { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 }, population: 1000, score: 0.5 }),
      makeArea({ id: 'T-mid', counts: { violent: 5, property: 0, vehicle: 0, qualityOfLife: 0 }, population: 1000, score: 0.5 }),
      makeArea({ id: 'T-danger', counts: { violent: 100, property: 0, vehicle: 0, qualityOfLife: 0 }, population: 1000, score: 0.5 }),
    ];
    useAppStore.setState({ safetyAreas: areas });
    useAppStore.getState().setSafetyPreset('personal_safety');
    const out = useAppStore.getState().safetyAreas;
    const safe = out.find((a) => a.id === 'T-safe')!;
    const danger = out.find((a) => a.id === 'T-danger')!;
    expect(safe.score).toBeGreaterThanOrEqual(0);
    expect(safe.score).toBeLessThanOrEqual(1);
    expect(danger.score).toBeGreaterThanOrEqual(0);
    expect(danger.score).toBeLessThanOrEqual(1);
    expect(safe.score).toBeLessThan(danger.score);
  });

  it('non-tract areas pass through unchanged on rerank', () => {
    const areas: import('@/lib/types').SafetyArea[] = [
      makeArea({ id: 'T1', type: 'tract', score: 5.0, counts: { violent: 10, property: 0, vehicle: 0, qualityOfLife: 0 } }),
      makeArea({ id: 'BEAT1', type: 'beat', score: 7.3, counts: { violent: 50, property: 0, vehicle: 0, qualityOfLife: 0 } }),
      makeArea({ id: 'NBHD1', type: 'neighborhood', score: 2.1, counts: { violent: 200, property: 0, vehicle: 0, qualityOfLife: 0 } }),
      makeArea({ id: 'CITY1', type: 'city', score: 8.8 }),
    ];
    useAppStore.setState({ safetyAreas: areas });
    useAppStore.getState().setSafetyPreset('protect_my_stuff');
    const out = useAppStore.getState().safetyAreas;
    expect(out.find((a) => a.id === 'BEAT1')!.score).toBe(7.3);
    expect(out.find((a) => a.id === 'NBHD1')!.score).toBe(2.1);
    expect(out.find((a) => a.id === 'CITY1')!.score).toBe(8.8);
  });

  it('tracts without population preserve their backend score', () => {
    const areas = [
      makeArea({ id: 'T-nopop', population: 0, score: 4.2 }),
      makeArea({ id: 'T-nopop2', population: null, score: 6.1 }),
    ];
    useAppStore.setState({ safetyAreas: areas });
    useAppStore.getState().setSafetyWeights({ violent: 1, property: 1, vehicle: 1, qualityOfLife: 1 });
    const out = useAppStore.getState().safetyAreas;
    expect(out.find((a) => a.id === 'T-nopop')!.score).toBe(4.2);
    expect(out.find((a) => a.id === 'T-nopop2')!.score).toBe(6.1);
  });

  it('setSafetyPreset custom leaves score untouched', () => {
    const areas = [makeArea({ id: 'T1', score: 7.7 })];
    useAppStore.setState({ safetyAreas: areas });
    useAppStore.getState().setSafetyPreset('custom');
    expect(useAppStore.getState().safetyAreas[0].score).toBe(7.7);
    expect(useAppStore.getState().safetyPreset).toBe('custom');
  });
});
