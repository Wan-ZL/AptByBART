import { create } from "zustand";
import type { Apartment, BartStation, CitySafety, Filters, SafetyArea } from "./types";
import type { SafetyWeights, SafetyPreset } from "./crime-taxonomy";
import { WEIGHT_PRESETS } from "./crime-taxonomy";

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
  maxRiskScore: 1,
};

// Client-side rerank for preset weights. Backend produces ensemble scores on the
// 0-1 percentile scale via /api/safety (0 = safest, 1 = most dangerous); for
// non-balanced presets we re-rank tracts locally using weighted per-capita rate
// so the UI can respond without a refetch. Non-tract areas pass through.
function recomputeSafetyAreaScores(
  safetyAreas: SafetyArea[],
  weights: SafetyWeights
): SafetyArea[] {
  const tracts = safetyAreas.filter((a) => a.type === 'tract');

  const withWeighted = tracts.map((area) => {
    const pop = area.population || 0;
    const weighted = pop > 0
      ? (area.counts.violent * weights.violent
        + area.counts.property * weights.property
        + area.counts.vehicle * weights.vehicle
        + area.counts.qualityOfLife * weights.qualityOfLife) / pop * 10000
      : 0;
    return { area, weighted, hasPop: pop > 0 };
  });

  const rankMap = new Map<string, number>();
  const ranked = withWeighted.filter((e) => e.hasPop).sort((a, b) => a.weighted - b.weighted);
  const n = ranked.length;
  for (let i = 0; i < n; i++) {
    const pos = n > 1 ? i / (n - 1) : 0;
    rankMap.set(ranked[i].area.id, Math.round(pos * 1000) / 1000);
  }

  return safetyAreas.map((area) => {
    if (area.type !== 'tract') return area;
    const pop = area.population || 0;
    return {
      ...area,
      score: pop > 0 ? (rankMap.get(area.id) ?? area.score) : area.score,
    };
  });
}

function computeFilteredApartments(
  apartments: Apartment[],
  filters: Filters,
  stations: BartStation[]
): Apartment[] {
  const stationMap = new Map(stations.map((s) => [s.id, s]));

  return apartments.filter((apt) => {
    if (apt.minPrice != null) {
      if (apt.minPrice < filters.priceRange[0]) return false;
      if (filters.priceRange[1] < 5000 && apt.minPrice > filters.priceRange[1]) return false;
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

    if (filters.maxRiskScore < 1 && apt.nearestStationId) {
      const station = stationMap.get(apt.nearestStationId);
      if (station?.safetyScore != null && station.safetyScore > filters.maxRiskScore) {
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

  // Safety v2
  safetyWeights: SafetyWeights;
  safetyPreset: SafetyPreset;
  safetyAreas: SafetyArea[];
  selectedSafetyAreaId: string | null;

  // Map
  mapStyle: string;
  safetyOverlayVisible: boolean;
  viewport: { latitude: number; longitude: number; zoom: number };

  // Actions — data
  setStations: (stations: BartStation[]) => void;
  setApartments: (apartments: Apartment[]) => void;
  setCitySafety: (citySafety: CitySafety[]) => void;
  setSafetyAreas: (areas: SafetyArea[]) => void;

  // Actions — filters
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setPriceRange: (range: [number, number]) => void;
  setBedrooms: (bedrooms: number[]) => void;
  toggleBedroom: (bedroom: number) => void;
  toggleAmenity: (
    key: "inUnitWd" | "dishwasher" | "parking" | "gym" | "pool" | "petFriendly"
  ) => void;
  setMaxCommute: (minutes: number) => void;
  setMaxRisk: (score: number) => void;
  resetFilters: () => void;

  // Actions — safety v2
  setSafetyWeights: (weights: SafetyWeights) => void;
  setSafetyPreset: (preset: SafetyPreset) => void;
  selectSafetyArea: (id: string | null) => void;

  // Actions — selection
  selectApartment: (id: number | null) => void;
  selectStation: (id: string | null) => void;

  // Actions — map
  setMapStyle: (style: string) => void;
  toggleSafetyOverlay: () => void;
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

  // Safety v2
  safetyWeights: WEIGHT_PRESETS.balanced,
  safetyPreset: 'balanced' as SafetyPreset,
  safetyAreas: [],
  selectedSafetyAreaId: null,

  // Selection
  selectedApartmentId: null,
  selectedStationId: null,

  // Map
  mapStyle: 'https://tiles.openfreemap.org/styles/positron',
  safetyOverlayVisible: true,
  viewport: { latitude: 37.5693, longitude: -121.8268, zoom: 9.5 },

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
  setSafetyAreas: (safetyAreas) => set({ safetyAreas }),

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

  setMaxRisk: (score) =>
    set((state) => {
      const filters = { ...state.filters, maxRiskScore: score };
      return { filters, filteredApartments: computeFilteredApartments(state.apartments, filters, state.stations) };
    }),

  resetFilters: () =>
    set((state) => ({
      filters: DEFAULT_FILTERS,
      filteredApartments: computeFilteredApartments(state.apartments, DEFAULT_FILTERS, state.stations),
    })),

  // Actions — safety v2
  setSafetyWeights: (weights) =>
    set((state) => ({
      safetyWeights: weights,
      safetyPreset: 'custom' as SafetyPreset,
      safetyAreas: recomputeSafetyAreaScores(state.safetyAreas, weights),
    })),

  setSafetyPreset: (preset) =>
    set((state) => {
      if (preset === 'custom') return { safetyPreset: preset };
      const weights = WEIGHT_PRESETS[preset];
      return {
        safetyPreset: preset,
        safetyWeights: weights,
        safetyAreas: recomputeSafetyAreaScores(state.safetyAreas, weights),
      };
    }),

  selectSafetyArea: (id) => set({ selectedSafetyAreaId: id }),

  // Actions — selection
  selectApartment: (id) => set({ selectedApartmentId: id }),
  selectStation: (id) => set({ selectedStationId: id }),

  // Actions — map
  setMapStyle: (style) => set({ mapStyle: style }),
  toggleSafetyOverlay: () =>
    set((state) => ({ safetyOverlayVisible: !state.safetyOverlayVisible })),
  setViewport: (vp) => set((state) => {
    const curr = state.viewport;
    if (curr.latitude === vp.latitude && curr.longitude === vp.longitude && curr.zoom === vp.zoom) {
      return {};
    }
    return { viewport: vp };
  }),
}));

// Selector for filtered apartments — use with useAppStore(selectFilteredApartments)
export function selectFilteredApartments(state: AppState): Apartment[] {
  return state.filteredApartments;
}
