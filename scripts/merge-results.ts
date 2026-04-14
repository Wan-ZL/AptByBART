import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
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

interface AmenityData {
  hasGym?: boolean;
  hasPool?: boolean;
  hasParking?: boolean;
  hasDoorman?: boolean;
  hasLaundry?: boolean;
  petFriendly?: boolean;
  [key: string]: boolean | undefined;
}

interface TierResult {
  plans: ScrapedFloorPlan[];
  amenities?: AmenityData;
}

interface TierFile {
  results: Record<string, TierResult>;
}

interface MergedApartment {
  bestTier: string | null;
  plans: ScrapedFloorPlan[];
  amenities: AmenityData;
  tierResults: Record<string, TierResult>;
  needsT4: boolean;
}

interface MergedOutput {
  apartments: Record<string, MergedApartment>;
  stats: {
    total: number;
    withPlans: number;
    withPrices: number;
    needsT4: number;
    byTier: Record<string, number>;
  };
}

interface T4PoolOutput {
  apartmentIds: number[];
  count: number;
  reasons: Record<string, string>;
}

const TIER_FILES: { key: string; filename: string }[] = [
  { key: 't1_rentcafe', filename: 't1_rentcafe.json' },
  { key: 't2_cheerio', filename: 't2_cheerio.json' },
  { key: 't3_crawl4ai', filename: 't3_crawl4ai.json' },
];

// Tier preference when plan counts are tied: T1 (structured API) > T3 (LLM) > T2 (regex)
const TIER_PRIORITY: Record<string, number> = {
  t1_rentcafe: 3,
  t3_crawl4ai: 2,
  t2_cheerio: 1,
};

function countPlansWithPrices(plans: ScrapedFloorPlan[]): number {
  return plans.filter(p => p.priceMin != null || p.priceMax != null).length;
}

function unionAmenities(sources: (AmenityData | undefined)[]): AmenityData {
  const merged: AmenityData = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [key, val] of Object.entries(src)) {
      if (val === true) merged[key] = true;
    }
  }
  return merged;
}

function pickBestTier(
  tierResults: Record<string, TierResult>
): { tierKey: string; plans: ScrapedFloorPlan[] } | null {
  // Filter to tiers that actually have plans
  const withPlans = Object.entries(tierResults).filter(
    ([, r]) => r.plans.length > 0
  );
  if (withPlans.length === 0) return null;

  let bestKey: string | null = null;
  let bestPricedCount = -1;
  let bestPriority = -1;

  for (const [key, result] of withPlans) {
    const pricedCount = countPlansWithPrices(result.plans);
    const priority = TIER_PRIORITY[key] ?? 0;

    if (
      pricedCount > bestPricedCount ||
      (pricedCount === bestPricedCount && priority > bestPriority)
    ) {
      bestKey = key;
      bestPricedCount = pricedCount;
      bestPriority = priority;
    }
  }

  if (!bestKey) return null;
  return { tierKey: bestKey, plans: tierResults[bestKey].plans };
}

function loadTierFile(filepath: string): TierFile | null {
  if (!existsSync(filepath)) {
    console.warn(`  Warning: ${filepath} not found, skipping`);
    return null;
  }
  const raw = readFileSync(filepath, 'utf-8');
  return JSON.parse(raw) as TierFile;
}

async function main() {
  const tierDir = resolve(__dirname, '..', 'tier_results');
  mkdirSync(tierDir, { recursive: true });

  // Load tier result files
  console.log('Loading tier result files...');
  const tierData: Record<string, TierFile> = {};
  let loadedCount = 0;
  for (const { key, filename } of TIER_FILES) {
    const data = loadTierFile(resolve(tierDir, filename));
    if (data) {
      tierData[key] = data;
      const aptCount = Object.keys(data.results).length;
      console.log(`  ${key}: ${aptCount} apartments`);
      loadedCount++;
    }
  }

  if (loadedCount === 0) {
    console.error('No tier result files found. Run per-tier scraping first.');
    process.exit(1);
  }

  // Load apartment list from DB
  console.log('\nLoading apartments from DB...');
  const rows = await db.execute('SELECT id, name, website_url FROM apartments');
  const apartments = rows.rows as unknown as { id: number; name: string; website_url: string }[];
  console.log(`  ${apartments.length} apartments in DB`);

  // Collect all apartment IDs from both DB and tier files
  const allIds = new Set<string>();
  for (const apt of apartments) allIds.add(String(apt.id));
  for (const tierFile of Object.values(tierData)) {
    for (const id of Object.keys(tierFile.results)) allIds.add(id);
  }

  // Merge
  console.log(`\nMerging results for ${allIds.size} apartments...`);
  const merged: Record<string, MergedApartment> = {};
  const t4Pool: T4PoolOutput = { apartmentIds: [], count: 0, reasons: {} };
  const stats = {
    total: allIds.size,
    withPlans: 0,
    withPrices: 0,
    needsT4: 0,
    byTier: {} as Record<string, number>,
  };

  for (const id of allIds) {
    // Collect tier results for this apartment
    const tierResults: Record<string, TierResult> = {};
    for (const [tierKey, tierFile] of Object.entries(tierData)) {
      if (tierFile.results[id]) {
        tierResults[tierKey] = tierFile.results[id];
      }
    }

    // Pick best plans
    const best = pickBestTier(tierResults);

    // Union amenities across all tiers (T2 is main amenity source but we merge all)
    const amenities = unionAmenities(
      Object.values(tierResults).map(r => r.amenities)
    );

    // Determine if T4 is needed
    let needsT4 = false;
    let t4Reason: string | undefined;

    if (!best) {
      // No tier produced any plans
      needsT4 = true;
      t4Reason = 'no_plans';
    } else if (countPlansWithPrices(best.plans) === 0) {
      // Plans exist but ALL prices are null
      needsT4 = true;
      t4Reason = 'no_prices';
    }

    merged[id] = {
      bestTier: best?.tierKey ?? null,
      plans: best?.plans ?? [],
      amenities,
      tierResults,
      needsT4,
    };

    // Update stats
    if (best && best.plans.length > 0) stats.withPlans++;
    if (best && countPlansWithPrices(best.plans) > 0) stats.withPrices++;
    if (needsT4) {
      stats.needsT4++;
      t4Pool.apartmentIds.push(Number(id));
      t4Pool.reasons[id] = t4Reason!;
    }
    if (best) {
      stats.byTier[best.tierKey] = (stats.byTier[best.tierKey] || 0) + 1;
    }
  }

  t4Pool.count = t4Pool.apartmentIds.length;
  t4Pool.apartmentIds.sort((a, b) => a - b);

  // Write outputs
  const mergedOutput: MergedOutput = { apartments: merged, stats };
  const mergedPath = resolve(tierDir, 'merged.json');
  writeFileSync(mergedPath, JSON.stringify(mergedOutput, null, 2));
  console.log(`\nWrote ${mergedPath}`);

  const t4Path = resolve(tierDir, 't4_pool.json');
  writeFileSync(t4Path, JSON.stringify(t4Pool, null, 2));
  console.log(`Wrote ${t4Path}`);

  // Print summary
  console.log('\n=== Merge Summary ===');
  console.log(`Total apartments:  ${stats.total}`);
  console.log(`With plans:        ${stats.withPlans}`);
  console.log(`With prices:       ${stats.withPrices}`);
  console.log(`Need T4:           ${stats.needsT4}`);
  console.log('\nBest tier breakdown:');
  for (const [tier, count] of Object.entries(stats.byTier).sort(
    ([, a], [, b]) => b - a
  )) {
    console.log(`  ${tier}: ${count}`);
  }
  const noTier = stats.total - stats.withPlans;
  if (noTier > 0) console.log(`  (no plans): ${noTier}`);

  // T4 reason breakdown
  const reasonCounts: Record<string, number> = {};
  for (const reason of Object.values(t4Pool.reasons)) {
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  console.log('\nT4 pool reasons:');
  for (const [reason, count] of Object.entries(reasonCounts)) {
    console.log(`  ${reason}: ${count}`);
  }
}

main().catch((err) => {
  console.error('Merge failed:', err);
  process.exit(1);
});
