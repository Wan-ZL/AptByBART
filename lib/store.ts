import { create } from "zustand";
import type { Apartment, BartStation, CitySafety, Filters } from "./types";

const DEFAULT_FILTERS: Filters = {
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
};

function computeFilteredApartments(
  apartments: Apartment[],
  filters: Filters,
  stations: BartStation[]
): Apartment[] {
  const stationMap = new Map(stations.map((s) => [s.id, s]));

  return apartments.filter((apt) => {
    if (apt.minPrice != null) {
      if (apt.minPrice < filters.priceRange[0] || apt.minPrice > filters.priceRange[1]) {
        return false;
      }
    }

    if (filters.bedrooms.length > 0) {
      if (!apt.bedroomTypes.some((b) => filters.bedrooms.includes(b))) {
        return false;
      }
    }

    if (filters.inUnitWd && !apt.hasInUnitWd) return false;
    if (filters.dishwasher && !apt.hasDishwasher) return false;
    if (filters.parking && !apt.hasParking) return false;
    if (filters.gym && !apt.hasGym) return false;
    if (filters.pool && !apt.hasPool) return false;
    if (filters.petFriendly && !apt.petFriendly) return false;

    if (filters.maxCommuteMin < 60 && apt.nearestStationId) {
      const station = stationMap.get(apt.nearestStationId);
      if (station?.travelTimeMin != null) {
        const totalCommute = station.travelTimeMin + (apt.walkMinToBart ?? 0);
        if (totalCommute > filters.maxCommuteMin) return false;
      }
    }

    if (filters.minSafetyScore > 1 && apt.nearestStationId) {
      const station = stationMap.get(apt.nearestStationId);
      if (station?.safetyScore != null && station.safetyScore < filters.minSafetyScore) {
        return false;
      }
    }

    return true;
  });
}

interface AppState {
  // Data
  stations: BartStation[];
  apartments: Apartment[];
  citySafety: CitySafety[];

  // Derived
  filteredApartments: Apartment[];

  // Filters
  filters: Filters;

  // Selection
  selectedApartmentId: number | null;
  selectedStationId: string | null;

  // Map
  safetyOverlayVisible: boolean;
  safetyRadius: number; // meters
  viewport: { latitude: number; longitude: number; zoom: number };

  // Actions — data
  setStations: (stations: BartStation[]) => void;
  setApartments: (apartments: Apartment[]) => void;
  setCitySafety: (citySafety: CitySafety[]) => void;

  // Actions — filters
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setPriceRange: (range: [number, number]) => void;
  setBedrooms: (bedrooms: number[]) => void;
  toggleBedroom: (bedroom: number) => void;
  toggleAmenity: (
    key: "inUnitWd" | "dishwasher" | "parking" | "gym" | "pool" | "petFriendly"
  ) => void;
  setMaxCommute: (minutes: number) => void;
  setMinSafety: (score: number) => void;
  resetFilters: () => void;

  // Actions — selection
  selectApartment: (id: number | null) => void;
  selectStation: (id: string | null) => void;

  // Actions — map
  toggleSafetyOverlay: () => void;
  setSafetyRadius: (radius: number) => void;
  setViewport: (vp: { latitude: number; longitude: number; zoom: number }) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  // Data
  stations: [],
  apartments: [],
  citySafety: [],

  // Derived
  filteredApartments: [],

  // Filters
  filters: DEFAULT_FILTERS,

  // Selection
  selectedApartmentId: null,
  selectedStationId: null,

  // Map
  safetyOverlayVisible: false,
  safetyRadius: 5000,
  viewport: { latitude: 37.7749, longitude: -122.2194, zoom: 10 },

  // Actions — data
  setStations: (stations) =>
    set((state) => ({
      stations,
      filteredApartments: computeFilteredApartments(state.apartments, state.filters, stations),
    })),
  setApartments: (apartments) =>
    set((state) => ({
      apartments,
      filteredApartments: computeFilteredApartments(apartments, state.filters, state.stations),
    })),
  setCitySafety: (citySafety) => set({ citySafety }),

  // Actions — filters
  setFilter: (key, value) =>
    set((state) => {
      const filters = { ...state.filters, [key]: value };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  setPriceRange: (range) =>
    set((state) => {
      const filters = { ...state.filters, priceRange: range };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  setBedrooms: (bedrooms) =>
    set((state) => {
      const filters = { ...state.filters, bedrooms };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  toggleBedroom: (bedroom) =>
    set((state) => {
      const current = state.filters.bedrooms;
      const next = current.includes(bedroom)
        ? current.filter((b) => b !== bedroom)
        : [...current, bedroom];
      const filters = { ...state.filters, bedrooms: next };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  toggleAmenity: (key) =>
    set((state) => {
      const filters = { ...state.filters, [key]: !state.filters[key] };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  setMaxCommute: (minutes) =>
    set((state) => {
      const filters = { ...state.filters, maxCommuteMin: minutes };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  setMinSafety: (score) =>
    set((state) => {
      const filters = { ...state.filters, minSafetyScore: score };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  resetFilters: () =>
    set((state) => ({
      filters: DEFAULT_FILTERS,
      filteredApartments: computeFilteredApartments(state.apartments, DEFAULT_FILTERS, state.stations),
    })),

  // Actions — selection
  selectApartment: (id) => set({ selectedApartmentId: id }),
  selectStation: (id) => set({ selectedStationId: id }),

  // Actions — map
  toggleSafetyOverlay: () =>
    set((state) => ({ safetyOverlayVisible: !state.safetyOverlayVisible })),
  setSafetyRadius: (radius) => set({ safetyRadius: radius }),

  setViewport: (vp) => set({ viewport: vp }),
}));

// Selector for filtered apartments — use with useAppStore(selectFilteredApartments)
export function selectFilteredApartments(state: AppState): Apartment[] {
  return state.filteredApartments;
}
