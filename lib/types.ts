export interface BartStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  lineColors: string[];
  travelTimeMin: number | null;
  fareCents: number | null;
  monthlyCommuteCost: number | null;
  safetyScore: number | null;
}

export interface CitySafety {
  city: string;
  lat: number;
  lng: number;
  safetyScore: number | null;
}

export interface Apartment {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  websiteUrl: string;
  nearestStationId: string | null;
  walkMinToBart: number | null;
  hasInUnitWd: boolean;
  hasDishwasher: boolean;
  hasParking: boolean;
  parkingType: string | null;
  hasGym: boolean;
  hasPool: boolean;
  petFriendly: boolean;
  scrapeStatus: string;
  lastScrapedAt: string | null;
  // Derived from floor plans (added by API)
  minPrice: number | null;
  maxPrice: number | null;
  bedroomTypes: number[]; // e.g., [0, 1, 2] for studio, 1BR, 2BR
}

export interface FloorPlan {
  id: number;
  apartmentId: number;
  name: string | null;
  bedrooms: number;
  bathrooms: number;
  sqftMin: number | null;
  sqftMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
  availableUnits: number;
}

export interface PriceHistoryEntry {
  date: string;
  priceMin: number;
  priceMax: number;
  availableUnits: number | null;
}

export interface CrimeMonth {
  year: number;
  month: number;
  violent: number;
  property: number;
  vehicle: number;
  total: number;
  safetyScore: number | null;
}

export interface ApartmentDetail extends Apartment {
  floorPlans: FloorPlan[];
  priceHistory: Record<number, PriceHistoryEntry[]>; // keyed by floor_plan_id
  nearestStation: BartStation | null;
}

export interface Filters {
  priceRange: [number, number];
  bedrooms: number[]; // selected bedroom counts, empty = all
  inUnitWd: boolean;
  dishwasher: boolean;
  parking: boolean;
  gym: boolean;
  pool: boolean;
  petFriendly: boolean;
  maxCommuteMin: number; // max minutes, 60 = no limit
  minSafetyScore: number; // 1-10, 1 = no filter
}

export interface SafetyArea {
  id: string;
  name: string;
  type: 'city' | 'neighborhood' | 'beat' | 'county' | 'tract';
  parentId: string | null;
  score: number;
  counts: {
    violent: number;
    property: number;
    vehicle: number;
    qualityOfLife: number;
  };
  sources: string[];
  centroidLat: number;
  centroidLng: number;
  percentile?: number;  // 0-100, "safer than X% of Bay Area"
  population: number | null;
  perCapitaRate: number | null;
  dataGranularity: 'direct' | 'inherited';
}
