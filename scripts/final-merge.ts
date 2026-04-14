import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { db } from '../db/client';

// Load .env.local manually (no dotenv dependency)
try {
  const envPath = resolve(__dirname, '..', '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not found — rely on environment variables
}

// Same validation as scrape.ts
const GARBAGE_NAME_PATTERNS = /cookie|advertising|analytics|targeting|performance|greystar|strictly necessary|functional|social media|social networking|google ad|essential/i;

interface ScrapedFloorPlan {
  name: string | null;
  bedrooms: number;
  bathrooms: number;
  sqftMin: number | null;
  sqftMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
  availableUnits: number | null;
  floorPlanUrl?: string;
}

interface MergedApartment {
  id: number;
  name: string;
  websiteUrl: string;
  bestTier: string;
  plans: ScrapedFloorPlan[];
  amenities: {
    hasInUnitWd: boolean;
    hasDishwasher: boolean;
    hasParking: boolean;
    hasGym: boolean;
    hasPool: boolean;
    petFriendly: boolean;
  };
}

interface T4Result {
  id: number;
  name: string;
  plans: ScrapedFloorPlan[];
  amenities?: {
    hasInUnitWd: boolean;
    hasDishwasher: boolean;
    hasParking: boolean;
    hasGym: boolean;
    hasPool: boolean;
    petFriendly: boolean;
  };
}

function finiteOrNull(val: number | null | undefined): number | null {
  if (val == null || !Number.isFinite(val)) return null;
  return val;
}

function validateFloorPlans(plans: ScrapedFloorPlan[]): ScrapedFloorPlan[] {
  return plans.filter((plan) => {
    if (plan.name && GARBAGE_NAME_PATTERNS.test(plan.name)) return false;
    if (plan.priceMin != null && (plan.priceMin < 100 || plan.priceMin > 15000)) return false;
    if (plan.priceMax != null && (plan.priceMax < 100 || plan.priceMax > 15000)) return false;
    return true;
  });
}

function mergeAmenities(
  base: MergedApartment['amenities'],
  overlay?: T4Result['amenities']
): MergedApartment['amenities'] {
  if (!overlay) return base;
  // Union: if either source detected an amenity, keep it
  return {
    hasInUnitWd: base.hasInUnitWd || overlay.hasInUnitWd,
    hasDishwasher: base.hasDishwasher || overlay.hasDishwasher,
    hasParking: base.hasParking || overlay.hasParking,
    hasGym: base.hasGym || overlay.hasGym,
    hasPool: base.hasPool || overlay.hasPool,
    petFriendly: base.petFriendly || overlay.petFriendly,
  };
}

async function main() {
  console.log('=== Final Merge to DB ===\n');

  const mergedPath = resolve(__dirname, '..', 'tier_results', 'merged.json');
  const t4Path = resolve(__dirname, '..', 'tier_results', 't4_ai_playwright.json');

  // Load merged T1/T2/T3 results
  if (!existsSync(mergedPath)) {
    console.error(`ERROR: ${mergedPath} not found. Run merge-results.ts first.`);
    process.exit(1);
  }

  // merged.json format: { apartments: { [id]: {...} }, stats: {...} }
  // Note: id/name may not be in the value objects, so inject from keys
  const mergedRaw = JSON.parse(readFileSync(mergedPath, 'utf-8'));
  const mergedObj = mergedRaw.apartments || mergedRaw;
  const merged: MergedApartment[] = Object.entries(mergedObj).map(([key, val]: [string, any]) => ({
    id: val.id || Number(key),
    name: val.name || '',
    websiteUrl: val.websiteUrl || '',
    ...val,
  }));
  console.log(`Loaded ${merged.length} apartments from merged.json`);

  // Load T4 results if available
  // t4_ai_playwright.json format: { tier: ..., results: { [id]: { plans: [...] } }, stats: {...} }
  let t4Map = new Map<number, T4Result>();
  if (existsSync(t4Path)) {
    const t4Raw = JSON.parse(readFileSync(t4Path, 'utf-8'));
    const t4Results = t4Raw.results || t4Raw;
    if (typeof t4Results === 'object' && !Array.isArray(t4Results)) {
      // Object format: { "123": { plans: [...] } }
      for (const [id, data] of Object.entries(t4Results) as [string, any][]) {
        if (data.plans && data.plans.length > 0) {
          t4Map.set(Number(id), { id: Number(id), name: data.name || '', plans: data.plans, amenities: data.amenities });
        }
      }
    } else if (Array.isArray(t4Results)) {
      for (const r of t4Results) {
        if (r.plans && r.plans.length > 0) t4Map.set(r.id, r);
      }
    }
    console.log(`Loaded ${t4Map.size} T4 results with plans from t4_ai_playwright.json`);
  } else {
    console.log('No T4 results found — using merged results only');
  }

  let written = 0;
  let skipped = 0;
  let t4Used = 0;

  for (const apt of merged) {
    const t4 = t4Map.get(apt.id);

    // T4 overrides plans if it has valid results
    let plans: ScrapedFloorPlan[];
    let tierUsed: string;
    if (t4 && t4.plans && t4.plans.length > 0) {
      plans = t4.plans;
      tierUsed = 'ai-playwright';
      t4Used++;
    } else {
      plans = apt.plans;
      tierUsed = apt.bestTier;
    }

    // Validate plans
    const validPlans = validateFloorPlans(plans);
    if (validPlans.length === 0) {
      skipped++;
      continue;
    }

    // Merge amenities (union of all tiers including T4)
    const amenities = mergeAmenities(apt.amenities, t4?.amenities);

    // Delete existing floor plans
    await db.execute({
      sql: 'DELETE FROM floor_plans WHERE apartment_id = ?',
      args: [apt.id],
    });

    // Insert new floor plans + price history
    for (const plan of validPlans) {
      const priceMin = finiteOrNull(plan.priceMin);
      const priceMax = finiteOrNull(plan.priceMax);
      const sqftMin = finiteOrNull(plan.sqftMin);
      const sqftMax = finiteOrNull(plan.sqftMax);
      const availableUnits = finiteOrNull(plan.availableUnits) ?? 0;
      const bedrooms = finiteOrNull(plan.bedrooms) ?? 0;
      const bathrooms = finiteOrNull(plan.bathrooms) ?? 1;

      const result = await db.execute({
        sql: `INSERT INTO floor_plans (apartment_id, name, bedrooms, bathrooms, sqft_min, sqft_max, price_min, price_max, available_units, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [apt.id, plan.name ?? null, bedrooms, bathrooms, sqftMin, sqftMax, priceMin, priceMax, availableUnits],
      });

      // Insert price history
      const floorPlanId = Number(result.lastInsertRowid);
      if (priceMin !== null || priceMax !== null) {
        await db.execute({
          sql: `INSERT INTO price_history (floor_plan_id, price_min, price_max, available_units, recorded_at)
                VALUES (?, ?, ?, ?, datetime('now'))`,
          args: [floorPlanId, priceMin ?? 0, priceMax ?? priceMin ?? 0, availableUnits],
        });
      }
    }

    // Update apartment amenities + status
    await db.execute({
      sql: `UPDATE apartments SET
              has_in_unit_wd = ?, has_dishwasher = ?, has_parking = ?,
              has_gym = ?, has_pool = ?, pet_friendly = ?,
              scrape_status = 'active', last_scraped_at = datetime('now'),
              last_successful_tier = ?, updated_at = datetime('now')
            WHERE id = ?`,
      args: [
        amenities.hasInUnitWd ? 1 : 0,
        amenities.hasDishwasher ? 1 : 0,
        amenities.hasParking ? 1 : 0,
        amenities.hasGym ? 1 : 0,
        amenities.hasPool ? 1 : 0,
        amenities.petFriendly ? 1 : 0,
        tierUsed,
        apt.id,
      ],
    });

    written++;
  }

  console.log('\n=== Final Merge Summary ===');
  console.log(`Written to DB: ${written}`);
  console.log(`Skipped (no valid plans): ${skipped}`);
  console.log(`T4 overrides used: ${t4Used}`);
  console.log(`Total processed: ${merged.length}`);
}

main().catch(console.error);
