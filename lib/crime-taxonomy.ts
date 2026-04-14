// Crime categories
export type CrimeCategory = 'violent' | 'property' | 'vehicle' | 'quality_of_life';

// Normalized observation from any ingester
export interface CrimeObservation {
  sourceId: string;
  geoAreaId: string;
  periodStart: string;
  periodEnd: string;
  category: CrimeCategory;
  incidentCount: number;
  rawCategory?: string;
}

// Interface every ingester module must implement
export interface CrimeIngester {
  sourceId: string;
  sourceName: string;
  apiType: 'csv_download' | 'socrata' | 'rest_api';
  granularity: 'city' | 'neighborhood' | 'beat' | 'county';
  updateFrequency: 'annual' | 'daily' | '4_hour';
  fetch(): Promise<CrimeObservation[]>;
}

// Safety weights
export interface SafetyWeights {
  violent: number;
  property: number;
  vehicle: number;
  qualityOfLife: number;
}

export const DEFAULT_WEIGHTS: SafetyWeights = {
  violent: 3.0,
  property: 1.0,
  vehicle: 1.5,
  qualityOfLife: 0.5,
};

export type SafetyPreset = 'balanced' | 'personal_safety' | 'protect_my_stuff' | 'night_owl' | 'custom';

export const WEIGHT_PRESETS: Record<Exclude<SafetyPreset, 'custom'>, SafetyWeights> = {
  balanced: { violent: 3.0, property: 1.0, vehicle: 1.5, qualityOfLife: 0.5 },
  personal_safety: { violent: 5.0, property: 0.5, vehicle: 0.5, qualityOfLife: 1.0 },
  protect_my_stuff: { violent: 1.0, property: 4.0, vehicle: 3.0, qualityOfLife: 0.5 },
  night_owl: { violent: 4.0, property: 1.0, vehicle: 2.0, qualityOfLife: 2.0 },
};

// Category mappings for each data source
export const SOURCE_CATEGORY_MAPS: Record<string, Record<string, { category: CrimeCategory }>> = {
  ca_doj: {
    'Violent_sum': { category: 'violent' },
    'Property_sum': { category: 'property' },
    'VehicleTheft_sum': { category: 'vehicle' },
  },
  datasf: {
    'Assault': { category: 'violent' },
    'Robbery': { category: 'violent' },
    'Homicide': { category: 'violent' },
    'Rape': { category: 'violent' },
    'Human Trafficking (A), Commercial Sex Acts': { category: 'violent' },
    'Human Trafficking, Commercial Sex Acts': { category: 'violent' },
    'Weapons Offense': { category: 'violent' },
    'Weapons Offence': { category: 'violent' },
    'Burglary': { category: 'property' },
    'Larceny Theft': { category: 'property' },
    'Arson': { category: 'property' },
    'Vandalism': { category: 'property' },
    'Stolen Property': { category: 'property' },
    'Fraud': { category: 'property' },
    'Forgery And Counterfeiting': { category: 'property' },
    'Embezzlement': { category: 'property' },
    'Motor Vehicle Theft': { category: 'vehicle' },
    'Drug Offense': { category: 'quality_of_life' },
    'Drug Violation': { category: 'quality_of_life' },
    'Disorderly Conduct': { category: 'quality_of_life' },
    'Trespass': { category: 'quality_of_life' },
    'Prostitution': { category: 'quality_of_life' },
    'Liquor Laws': { category: 'quality_of_life' },
    'Gambling': { category: 'quality_of_life' },
  },
  oakland: {
    'ROBBERY': { category: 'violent' },
    'ASSAULT': { category: 'violent' },
    'HOMICIDE': { category: 'violent' },
    'MURDER': { category: 'violent' },
    'FELONY ASSAULT': { category: 'violent' },
    'MISDEMEANOR ASSAULT': { category: 'violent' },
    'DOMESTIC VIOLENCE': { category: 'violent' },
    'WEAPONS': { category: 'violent' },
    'PETTY THEFT': { category: 'property' },
    'GRAND THEFT': { category: 'property' },
    'BURG-RESIDENTIAL': { category: 'property' },
    'BURG-COMMERCIAL': { category: 'property' },
    'BURG - RESIDENTIAL': { category: 'property' },
    'BURG - COMMERCIAL': { category: 'property' },
    'VANDALISM': { category: 'property' },
    'ARSON': { category: 'property' },
    'FRAUD': { category: 'property' },
    'FORGERY': { category: 'property' },
    'BURG-AUTO': { category: 'vehicle' },
    'BURG - AUTO': { category: 'vehicle' },
    'STOLEN VEHICLE': { category: 'vehicle' },
    'VEHICLE THEFT': { category: 'vehicle' },
    'NARCOTICS': { category: 'quality_of_life' },
    'DISTURBING THE PEACE': { category: 'quality_of_life' },
    'TRESPASSING': { category: 'quality_of_life' },
    'PROSTITUTION': { category: 'quality_of_life' },
  },
  santa_clara: {
    'ASSAULT': { category: 'violent' },
    'ROBBERY': { category: 'violent' },
    'HOMICIDE': { category: 'violent' },
    'BATTERY': { category: 'violent' },
    'BURGLARY': { category: 'property' },
    'THEFT': { category: 'property' },
    'LARCENY': { category: 'property' },
    'VANDALISM': { category: 'property' },
    'FRAUD': { category: 'property' },
    'VEHICLE THEFT': { category: 'vehicle' },
    'STOLEN VEHICLE': { category: 'vehicle' },
    'SUSPICIOUS VEHICLE': { category: 'vehicle' },
    'DRUG': { category: 'quality_of_life' },
    'TRESPASS': { category: 'quality_of_life' },
    'DISTURBANCE': { category: 'quality_of_life' },
  },
  marin: {
    'ASSAULT': { category: 'violent' },
    'BATTERY': { category: 'violent' },
    'ROBBERY': { category: 'violent' },
    'HOMICIDE': { category: 'violent' },
    'BURGLARY': { category: 'property' },
    'THEFT': { category: 'property' },
    'LARCENY': { category: 'property' },
    'VANDALISM': { category: 'property' },
    'FRAUD': { category: 'property' },
    'VEHICLE THEFT': { category: 'vehicle' },
    'AUTO THEFT': { category: 'vehicle' },
    'DRUG': { category: 'quality_of_life' },
    'NARCOTICS': { category: 'quality_of_life' },
    'TRESPASS': { category: 'quality_of_life' },
    'DISTURBANCE': { category: 'quality_of_life' },
  },
  fbi: {
    'violent-crime': { category: 'violent' },
    'property-crime': { category: 'property' },
    'motor-vehicle-theft': { category: 'vehicle' },
  },
};

// Helper to map a raw category string to our taxonomy
export function mapCategory(sourceId: string, rawCategory: string): CrimeCategory | null {
  const sourceMap = SOURCE_CATEGORY_MAPS[sourceId];
  if (!sourceMap) return null;

  // Try exact match first
  if (sourceMap[rawCategory]) return sourceMap[rawCategory].category;

  // Try case-insensitive match
  const upper = rawCategory.toUpperCase();
  for (const [key, val] of Object.entries(sourceMap)) {
    if (key.toUpperCase() === upper) return val.category;
  }

  return null;
}
