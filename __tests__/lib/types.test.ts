import { describe, it, expect } from 'vitest';
import type {
  BartStation,
  Apartment,
  FloorPlan,
  PriceHistoryEntry,
  CrimeMonth,
  ApartmentDetail,
  Filters,
} from '@/lib/types';

describe('Type interfaces', () => {
  it('BartStation interface is usable with valid data', () => {
    const station: BartStation = {
      id: 'MONT',
      name: 'Montgomery St.',
      lat: 37.7894,
      lng: -122.4013,
      lineColors: ['yellow', 'green', 'red', 'blue'],
      travelTimeMin: 0,
      fareCents: 0,
      monthlyCommuteCost: 0,
      safetyScore: 8,
    };
    expect(station.id).toBe('MONT');
    expect(station.lineColors).toHaveLength(4);
    expect(station.travelTimeMin).toBe(0);
  });

  it('BartStation accepts null for optional numeric fields', () => {
    const station: BartStation = {
      id: 'TEST',
      name: 'Test Station',
      lat: 37.0,
      lng: -122.0,
      lineColors: [],
      travelTimeMin: null,
      fareCents: null,
      monthlyCommuteCost: null,
      safetyScore: null,
    };
    expect(station.travelTimeMin).toBeNull();
    expect(station.fareCents).toBeNull();
    expect(station.safetyScore).toBeNull();
  });

  it('Apartment interface is usable with valid data', () => {
    const apt: Apartment = {
      id: 1,
      name: 'Test Apartments',
      address: '123 Main St',
      lat: 37.8,
      lng: -122.3,
      websiteUrl: 'https://example.com',
      nearestStationId: 'MONT',
      walkMinToBart: 5,
      hasInUnitWd: true,
      hasDishwasher: true,
      hasParking: false,
      parkingType: null,
      hasGym: true,
      hasPool: false,
      petFriendly: true,
      scrapeStatus: 'ok',
      lastScrapedAt: '2026-04-08',
      minPrice: 2500,
      maxPrice: 4000,
      bedroomTypes: [0, 1, 2],
    };
    expect(apt.id).toBe(1);
    expect(apt.bedroomTypes).toContain(0);
    expect(apt.hasInUnitWd).toBe(true);
  });

  it('Apartment accepts null for optional fields', () => {
    const apt: Apartment = {
      id: 2,
      name: 'Minimal Apt',
      address: '456 Oak',
      lat: 37.7,
      lng: -122.4,
      websiteUrl: '',
      nearestStationId: null,
      walkMinToBart: null,
      hasInUnitWd: false,
      hasDishwasher: false,
      hasParking: false,
      parkingType: null,
      hasGym: false,
      hasPool: false,
      petFriendly: false,
      scrapeStatus: 'pending',
      lastScrapedAt: null,
      minPrice: null,
      maxPrice: null,
      bedroomTypes: [],
    };
    expect(apt.nearestStationId).toBeNull();
    expect(apt.minPrice).toBeNull();
  });

  it('FloorPlan interface is usable', () => {
    const fp: FloorPlan = {
      id: 1,
      apartmentId: 1,
      name: '1BR Classic',
      bedrooms: 1,
      bathrooms: 1,
      sqftMin: 650,
      sqftMax: 700,
      priceMin: 2500,
      priceMax: 2800,
      availableUnits: 3,
    };
    expect(fp.bedrooms).toBe(1);
    expect(fp.priceMin).toBe(2500);
  });

  it('PriceHistoryEntry interface is usable', () => {
    const entry: PriceHistoryEntry = {
      date: '2026-04-01',
      priceMin: 2400,
      priceMax: 2700,
    };
    expect(entry.date).toBe('2026-04-01');
  });

  it('CrimeMonth interface is usable', () => {
    const crime: CrimeMonth = {
      year: 2025,
      month: 12,
      violent: 5,
      property: 20,
      vehicle: 10,
      total: 35,
      safetyScore: 7,
    };
    expect(crime.total).toBe(35);
    expect(crime.safetyScore).toBe(7);
  });

  it('Filters interface has correct default shape', () => {
    const filters: Filters = {
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
    };
    expect(filters.priceRange).toEqual([1000, 5000]);
    expect(filters.bedrooms).toEqual([]);
    expect(filters.maxCommuteMin).toBe(60);
    expect(filters.maxRiskScore).toBe(1);
  });

  it('ApartmentDetail extends Apartment with extra fields', () => {
    const detail: ApartmentDetail = {
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
      minPrice: 2000,
      maxPrice: 3000,
      bedroomTypes: [1],
      floorPlans: [],
      priceHistory: {},
      nearestStation: null,
    };
    expect(detail.floorPlans).toEqual([]);
    expect(detail.priceHistory).toEqual({});
    expect(detail.nearestStation).toBeNull();
  });
});
