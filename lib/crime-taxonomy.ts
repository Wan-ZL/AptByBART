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
  granularity: 'city' | 'neighborhood' | 'beat' | 'county' | 'tract';
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
  richmond: {
    'ASSAULT': { category: 'violent' },
    'AGG ASSAULT': { category: 'violent' },
    'AGG ASSAULT FIREARM': { category: 'violent' },
    'AGG ASSAULT OFFICER': { category: 'violent' },
    'BATTERY': { category: 'violent' },
    'HOMICIDE': { category: 'violent' },
    'HOMICIDE 664': { category: 'violent' },
    'RAPE': { category: 'violent' },
    'KIDNAPPING': { category: 'violent' },
    'ROBBERY STRONGARM': { category: 'violent' },
    'ROBBERY FIREARM': { category: 'violent' },
    'ROBBERY OTH WPN': { category: 'violent' },
    'ROBBERY ESTES': { category: 'violent' },
    'ROBBERY HOME INVASION': { category: 'violent' },
    'ROBBERY CARJACKING': { category: 'violent' },
    'ROBBERY CARJACKING FIREARM': { category: 'violent' },
    'ROBBERY CARJACKING OTH WPN': { category: 'violent' },
    'DOMESTIC VIOLENCE': { category: 'violent' },
    'CRIMINAL THREATS': { category: 'violent' },
    'SEX CRIMES & TRAFFICKING': { category: 'violent' },
    'FIREARMS': { category: 'violent' },
    'FIREARM (DISCHARGE)': { category: 'violent' },
    'FIREARMS (DISCHARGE OTHER)': { category: 'violent' },
    'FIREARMS (OTHER)': { category: 'violent' },
    'WEAPONS': { category: 'violent' },
    'ABUSE & CRUELTY': { category: 'violent' },
    'FALSE IMPRISONMENT': { category: 'violent' },
    'EXTORTION': { category: 'violent' },
    'ARSON': { category: 'property' },
    'BURG (RESIDENTIAL)': { category: 'property' },
    'BURG (COMMERCIAL)': { category: 'property' },
    'BURG TOOLS': { category: 'property' },
    'THEFT': { category: 'property' },
    'VANDALISM': { category: 'property' },
    'FORGERY/FRAUD': { category: 'property' },
    'FRAUD FOR THEFT': { category: 'property' },
    'STOLEN PROPERTY': { category: 'property' },
    'VEHICLE THEFT': { category: 'vehicle' },
    'VEHICLE THEFT - RECOVERY': { category: 'vehicle' },
    'HIT AND RUN': { category: 'vehicle' },
    'VEHICLE VIOLATION - DUI': { category: 'vehicle' },
    'DRUGS & SUBSTANCES': { category: 'quality_of_life' },
    'DISORDERLY / LOITERING': { category: 'quality_of_life' },
    'TRESPASSING': { category: 'quality_of_life' },
    'QUALITY OF LIFE': { category: 'quality_of_life' },
    'ILLEGAL DUMPING': { category: 'quality_of_life' },
    'FIREWORKS': { category: 'quality_of_life' },
  },
  fbi: {
    'violent-crime': { category: 'violent' },
    'property-crime': { category: 'property' },
    'motor-vehicle-theft': { category: 'vehicle' },
  },
  sjpd: {
    // violent
    'BATTERY': { category: 'violent' },
    'ASSAULT WITH DEADLY WEAPON': { category: 'violent' },
    'ASSAULT': { category: 'violent' },
    'ROBBERY': { category: 'violent' },
    'HOMICIDE': { category: 'violent' },
    'SHOOTING INTO OCCP VEH OR DWELLING': { category: 'violent' },
    'SHOOTING': { category: 'violent' },
    'SEXUAL ASSAULT': { category: 'violent' },
    'RAPE': { category: 'violent' },
    'DOMESTIC VIOLENCE': { category: 'violent' },
    'KIDNAPPING': { category: 'violent' },
    'WEAPONS': { category: 'violent' },
    'BRANDISHING WEAPON': { category: 'violent' },
    // property
    'THEFT': { category: 'property' },
    'BURGLARY  REPORT  (460)': { category: 'property' },
    'BURGLARY': { category: 'property' },
    'COMMERCIAL BURGLARY': { category: 'property' },
    'RESIDENTIAL BURGLARY': { category: 'property' },
    'MALICIOUS MISCHIEF': { category: 'property' },
    'VANDALISM': { category: 'property' },
    'FRAUD': { category: 'property' },
    'FORGERY': { category: 'property' },
    'ARSON': { category: 'property' },
    'SHOPLIFTING': { category: 'property' },
    'PETTY THEFT': { category: 'property' },
    'GRAND THEFT': { category: 'property' },
    'IDENTITY THEFT': { category: 'property' },
    // vehicle
    'STOLEN VEHICLE': { category: 'vehicle' },
    'RECOVERED STOLEN VEHICLE': { category: 'vehicle' },
    'VEHICLE BURGLARY': { category: 'vehicle' },
    'AUTO THEFT': { category: 'vehicle' },
    'CARJACKING': { category: 'vehicle' },
    // quality of life
    'DISTURBANCE': { category: 'quality_of_life' },
    'DISTURBANCE, FAMILY': { category: 'quality_of_life' },
    'DISTURBANCE, MUSIC': { category: 'quality_of_life' },
    'DISTURBANCE, FIRECRACKERS': { category: 'quality_of_life' },
    'DISTURBANCE, UNKNOWN': { category: 'quality_of_life' },
    'TRESPASSING': { category: 'quality_of_life' },
    'NARCOTICS': { category: 'quality_of_life' },
    'DRUG': { category: 'quality_of_life' },
    'PROSTITUTION': { category: 'quality_of_life' },
    'PUBLIC INTOXICATION': { category: 'quality_of_life' },
    'DRUNK IN PUBLIC': { category: 'quality_of_life' },
    'RECKLESS DRIVING': { category: 'quality_of_life' },
  },
  // Alameda County Sheriff ArcGIS feed keys on NIBRS group codes parsed out of
  // the CrimeDescription trailer (e.g. "... F - 13A Aggravated Assault" → "13A").
  // The ingester in scripts/ingest/alameda-sheriff.ts extracts the code before
  // calling mapCategory, so the keys here are NIBRS codes, not free text.
  alameda_sheriff: {
    // violent (NIBRS Group A: 09*, 11*, 13*, 100, 120)
    '09A': { category: 'violent' }, // murder & nonnegligent manslaughter
    '09B': { category: 'violent' }, // negligent manslaughter
    '09C': { category: 'violent' }, // justifiable homicide
    '11A': { category: 'violent' }, // rape
    '11B': { category: 'violent' }, // sodomy
    '11C': { category: 'violent' }, // sexual assault with object
    '11D': { category: 'violent' }, // fondling
    '36A': { category: 'violent' }, // incest
    '36B': { category: 'violent' }, // statutory rape
    '13A': { category: 'violent' }, // aggravated assault
    '13B': { category: 'violent' }, // simple assault
    '13C': { category: 'violent' }, // intimidation
    '100': { category: 'violent' }, // kidnapping/abduction
    '120': { category: 'violent' }, // robbery
    '520': { category: 'violent' }, // weapon law violations
    '64A': { category: 'violent' }, // human trafficking, commercial sex
    '64B': { category: 'violent' }, // human trafficking, involuntary servitude
    // property
    '200': { category: 'property' }, // arson
    '220': { category: 'property' }, // burglary/breaking & entering
    '23A': { category: 'property' }, // pocket-picking
    '23B': { category: 'property' }, // purse-snatching
    '23C': { category: 'property' }, // shoplifting
    '23D': { category: 'property' }, // theft from building
    '23E': { category: 'property' }, // theft from coin-operated machine
    '23F': { category: 'property' }, // theft from motor vehicle
    '23G': { category: 'property' }, // theft of motor vehicle parts
    '23H': { category: 'property' }, // all other larceny
    '250': { category: 'property' }, // counterfeiting/forgery
    '26A': { category: 'property' }, // false pretenses/swindle
    '26B': { category: 'property' }, // credit card/atm fraud
    '26C': { category: 'property' }, // impersonation
    '26D': { category: 'property' }, // welfare fraud
    '26E': { category: 'property' }, // wire fraud
    '26F': { category: 'property' }, // identity theft
    '26G': { category: 'property' }, // hacking/computer invasion
    '270': { category: 'property' }, // embezzlement
    '280': { category: 'property' }, // stolen property offenses
    '290': { category: 'property' }, // destruction/damage/vandalism
    '510': { category: 'property' }, // bribery
    // vehicle
    '240': { category: 'vehicle' }, // motor vehicle theft
    // quality of life
    '35A': { category: 'quality_of_life' }, // drug/narcotic violations
    '35B': { category: 'quality_of_life' }, // drug equipment violations
    '370': { category: 'quality_of_life' }, // pornography/obscene material
    '39A': { category: 'quality_of_life' }, // betting/wagering
    '39B': { category: 'quality_of_life' }, // operating/promoting/assisting gambling
    '39C': { category: 'quality_of_life' }, // gambling equipment violations
    '39D': { category: 'quality_of_life' }, // sports tampering
    '40A': { category: 'quality_of_life' }, // prostitution
    '40B': { category: 'quality_of_life' }, // assisting/promoting prostitution
    '40C': { category: 'quality_of_life' }, // purchasing prostitution
    '720': { category: 'quality_of_life' }, // animal cruelty
    '90A': { category: 'quality_of_life' }, // bad checks
    '90B': { category: 'quality_of_life' }, // curfew/loitering/vagrancy
    '90C': { category: 'quality_of_life' }, // disorderly conduct
    '90D': { category: 'quality_of_life' }, // driving under the influence
    '90E': { category: 'quality_of_life' }, // drunkenness
    '90F': { category: 'quality_of_life' }, // family offenses, nonviolent
    '90G': { category: 'quality_of_life' }, // liquor law violations
    '90H': { category: 'quality_of_life' }, // peeping tom
    '90I': { category: 'quality_of_life' }, // runaway
    '90J': { category: 'quality_of_life' }, // trespass of real property
    // '90Z' (All Other Offenses) is intentionally unmapped — it's a catch-all
    // that would muddy every category if forced into one.
  },
  // Berkeley PD dataset (k2nh-s5h5) uses CVLEGEND as the normalized category
  // field. Values are UPPER CASE with dashes, e.g. "BURGLARY - VEHICLE".
  berkeley: {
    'ASSAULT': { category: 'violent' },
    'ROBBERY': { category: 'violent' },
    'HOMICIDE': { category: 'violent' },
    'SEX CRIME': { category: 'violent' },
    'WEAPONS OFFENSE': { category: 'violent' },
    'KIDNAPPING': { category: 'violent' },
    'BURGLARY - COMMERCIAL': { category: 'property' },
    'BURGLARY - RESIDENTIAL': { category: 'property' },
    'BURGLARY - OTHER': { category: 'property' },
    'LARCENY': { category: 'property' },
    'LARCENY - FROM VEHICLE': { category: 'property' },
    'THEFT': { category: 'property' },
    'THEFT FELONY (OVER $950)': { category: 'property' },
    'THEFT MISDEMEANOR (UNDER $950)': { category: 'property' },
    'VANDALISM': { category: 'property' },
    'ARSON': { category: 'property' },
    'FRAUD': { category: 'property' },
    'IDENTITY THEFT': { category: 'property' },
    'BURGLARY - VEHICLE': { category: 'vehicle' },
    'MOTOR VEHICLE THEFT': { category: 'vehicle' },
    'VEHICLE THEFT': { category: 'vehicle' },
    'RECOVERED VEHICLE': { category: 'vehicle' },
    'DRUG VIOLATION': { category: 'quality_of_life' },
    'NARCOTICS': { category: 'quality_of_life' },
    'DISORDERLY CONDUCT': { category: 'quality_of_life' },
    'DISTURBING THE PEACE': { category: 'quality_of_life' },
    'LIQUOR LAW VIOLATION': { category: 'quality_of_life' },
    'PROSTITUTION': { category: 'quality_of_life' },
    'TRESPASS': { category: 'quality_of_life' },
    'NOISE VIOLATION': { category: 'quality_of_life' },
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
