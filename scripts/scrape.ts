import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { db } from '../db/client';
import { scrapeRentCafe, ScrapedFloorPlan } from './scrapers/rentcafe';
import { scrapeWithCheerio, scrapeAmenitiesFromUrl, detectAmenities, validatePrices } from './scrapers/http-cheerio';
import { scrapeWithCrawl4AI } from './scrapers/crawl4ai-scraper';
import { scrapeWithAIPlaywright } from './scrapers/ai-playwright-scraper';

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

const TIER_RESULTS_DIR = resolve(__dirname, '..', 'tier_results');

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0;
  const total = items.length;

  async function worker() {
    while (index < total) {
      const i = index++;
      await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
}

interface Apartment {
  id: number;
  name: string;
  website_url: string;
  scrape_status: string;
  last_successful_tier: string | null;
}

type ScraperFn = (apt: { id: number; websiteUrl: string }) => Promise<ScrapedFloorPlan[] | null>;

const allTiers: { name: string; fn: ScraperFn }[] = [
  { name: 'rentcafe', fn: scrapeRentCafe },
  { name: 'cheerio', fn: scrapeWithCheerio },
  { name: 'crawl4ai', fn: scrapeWithCrawl4AI },
  { name: 'ai-playwright', fn: scrapeWithAIPlaywright },
];

// Sanitize a numeric value: replace Infinity, NaN, or undefined with null
function finiteOrNull(val: number | null | undefined): number | null {
  if (val == null || !Number.isFinite(val)) return null;
  return val;
}

// Reject floor plans that are clearly garbage data (cookie banners, tracking categories, etc.)
const GARBAGE_NAME_PATTERNS = /cookie|advertising|analytics|targeting|performance|greystar|strictly necessary|functional|social media|social networking|google ad|essential/i;

function validateFloorPlans(plans: ScrapedFloorPlan[]): ScrapedFloorPlan[] {
  return plans.filter((plan) => {
    if (plan.name && GARBAGE_NAME_PATTERNS.test(plan.name)) return false;
    if (plan.priceMin != null && (plan.priceMin < 100 || plan.priceMin > 15000)) return false;
    if (plan.priceMax != null && (plan.priceMax < 100 || plan.priceMax > 15000)) return false;
    return true;
  });
}

async function upsertFloorPlans(apartmentId: number, plans: ScrapedFloorPlan[]) {
  const validPlans = validateFloorPlans(plans);
  if (validPlans.length === 0 && plans.length > 0) {
    console.log(`  ⚠ All ${plans.length} floor plans rejected by validation`);
    return;
  }
  if (validPlans.length < plans.length) {
    console.log(`  ⚠ Rejected ${plans.length - validPlans.length}/${plans.length} invalid floor plans`);
  }

  await db.execute({
    sql: 'DELETE FROM floor_plans WHERE apartment_id = ?',
    args: [apartmentId],
  });

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
      args: [
        apartmentId,
        plan.name,
        bedrooms,
        bathrooms,
        sqftMin,
        sqftMax,
        priceMin,
        priceMax,
        availableUnits,
      ],
    });

    const floorPlanId = Number(result.lastInsertRowid);
    if (priceMin !== null || priceMax !== null) {
      await db.execute({
        sql: `INSERT INTO price_history (floor_plan_id, price_min, price_max, available_units, recorded_at)
              VALUES (?, ?, ?, ?, datetime('now'))`,
        args: [
          floorPlanId,
          priceMin ?? 0,
          priceMax ?? priceMin ?? 0,
          availableUnits,
        ],
      });
    }
  }
}

async function logScrape(
  apartmentId: number,
  status: string,
  durationMs: number,
  errorMessage?: string
) {
  await db.execute({
    sql: `INSERT INTO scrape_logs (apartment_id, status, duration_ms, error_message, started_at, completed_at)
          VALUES (?, ?, ?, ?, datetime('now', '-' || ? || ' seconds'), datetime('now'))`,
    args: [
      apartmentId,
      status,
      durationMs,
      errorMessage ?? null,
      Math.round(durationMs / 1000),
    ],
  });
}

async function getConsecutiveFailures(apartmentId: number): Promise<number> {
  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM (
            SELECT status FROM scrape_logs
            WHERE apartment_id = ?
            ORDER BY started_at DESC
            LIMIT 3
          ) WHERE status != 'success'`,
    args: [apartmentId],
  });
  return Number(result.rows[0]?.count ?? 0);
}

// --- Per-tier result types ---

interface TierResultEntry {
  apartmentId: number;
  name: string;
  url: string;
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

interface TierResultFile {
  tier: string;
  timestamp: string;
  results: Record<string, TierResultEntry>;
  stats: { total: number; succeeded: number; failed: number };
}

function saveTierResults(filename: string, data: TierResultFile) {
  if (!existsSync(TIER_RESULTS_DIR)) {
    mkdirSync(TIER_RESULTS_DIR, { recursive: true });
  }
  const filepath = resolve(TIER_RESULTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`\nSaved results to ${filepath}`);
}

// --- Parse CLI args ---

function parseTierArg(): string | null {
  const idx = process.argv.indexOf('--tier');
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  if (!val || !['t1', 't2', 't3', 't4'].includes(val)) {
    console.error('Invalid --tier value. Use: t1, t2, t3, or t4');
    process.exit(1);
  }
  return val;
}

// --- Per-tier runners ---

async function runTierT1(apartments: Apartment[]) {
  console.log(`\n=== T1 RentCafe — ${apartments.length} apartments ===\n`);

  const results: Record<string, TierResultEntry> = {};
  let succeeded = 0;
  let failed = 0;

  const CONCURRENCY = 5;

  await mapConcurrent(apartments, CONCURRENCY, async (apt, i) => {
    console.log(`[${i + 1}/${apartments.length}] ${apt.name} (ID: ${apt.id})`);
    try {
      const plans = await scrapeRentCafe({ id: apt.id, websiteUrl: apt.website_url });
      if (plans && plans.length > 0) {
        const valid = validateFloorPlans(plans);
        if (valid.length > 0) {
          console.log(`  ✓ ${valid.length} floor plans`);
          results[String(apt.id)] = {
            apartmentId: apt.id,
            name: apt.name,
            url: apt.website_url,
            plans: valid,
          };
          succeeded++;
          return;
        }
      }
      console.log('  ✗ No results');
      failed++;
    } catch (err) {
      console.log(`  ✗ Error: ${(err as Error).message}`);
      failed++;
    }
  });

  const data: TierResultFile = {
    tier: 't1_rentcafe',
    timestamp: new Date().toISOString(),
    results,
    stats: { total: apartments.length, succeeded, failed },
  };
  saveTierResults('t1_rentcafe.json', data);
  console.log(`\n=== T1 Summary: ${succeeded} succeeded, ${failed} failed out of ${apartments.length} ===`);
}

async function runTierT2(apartments: Apartment[]) {
  console.log(`\n=== T2 Cheerio — ${apartments.length} apartments ===\n`);

  const results: Record<string, TierResultEntry> = {};
  let succeeded = 0;
  let failed = 0;

  const CONCURRENCY = 5;

  await mapConcurrent(apartments, CONCURRENCY, async (apt, i) => {
    console.log(`[${i + 1}/${apartments.length}] ${apt.name} (ID: ${apt.id})`);
    try {
      // Fetch HTML once for both floor plans and amenities
      const res = await fetch(apt.website_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.log(`  ✗ HTTP ${res.status}`);
        failed++;
        return;
      }

      const html = await res.text();

      // Run scrapeWithCheerio for floor plans
      const plans = await scrapeWithCheerio({ id: apt.id, websiteUrl: apt.website_url });

      // Detect amenities from the fetched HTML
      const amenities = detectAmenities(html);

      if (plans && plans.length > 0) {
        const validated = validatePrices(plans, html);
        const valid = validateFloorPlans(validated);
        if (valid.length > 0) {
          console.log(`  ✓ ${valid.length} floor plans + amenities`);
          results[String(apt.id)] = {
            apartmentId: apt.id,
            name: apt.name,
            url: apt.website_url,
            plans: valid,
            amenities,
          };
          succeeded++;
          return;
        }
      }

      // Even if no floor plans, save amenities if detected
      if (amenities.hasInUnitWd || amenities.hasDishwasher || amenities.hasParking ||
          amenities.hasGym || amenities.hasPool || amenities.petFriendly) {
        console.log('  ~ No floor plans, but amenities detected');
        results[String(apt.id)] = {
          apartmentId: apt.id,
          name: apt.name,
          url: apt.website_url,
          plans: [],
          amenities,
        };
      }

      console.log('  ✗ No floor plans');
      failed++;
    } catch (err) {
      console.log(`  ✗ Error: ${(err as Error).message}`);
      failed++;
    }
  });

  const data: TierResultFile = {
    tier: 't2_cheerio',
    timestamp: new Date().toISOString(),
    results,
    stats: { total: apartments.length, succeeded, failed },
  };
  saveTierResults('t2_cheerio.json', data);
  console.log(`\n=== T2 Summary: ${succeeded} succeeded, ${failed} failed out of ${apartments.length} ===`);
}

async function runTierT3(apartments: Apartment[]) {
  console.log(`\n=== T3 Crawl4AI — ${apartments.length} apartments ===\n`);

  const results: Record<string, TierResultEntry> = {};
  let succeeded = 0;
  let failed = 0;

  const CONCURRENCY = 3;

  await mapConcurrent(apartments, CONCURRENCY, async (apt, i) => {
    console.log(`[${i + 1}/${apartments.length}] ${apt.name} (ID: ${apt.id})`);
    try {
      const plans = await scrapeWithCrawl4AI({ id: apt.id, websiteUrl: apt.website_url });
      if (plans && plans.length > 0) {
        const valid = validateFloorPlans(plans);
        if (valid.length > 0) {
          console.log(`  ✓ ${valid.length} floor plans`);
          results[String(apt.id)] = {
            apartmentId: apt.id,
            name: apt.name,
            url: apt.website_url,
            plans: valid,
          };
          succeeded++;
          return;
        }
      }
      console.log('  ✗ No results');
      failed++;
    } catch (err) {
      console.log(`  ✗ Error: ${(err as Error).message}`);
      failed++;
    }
  });

  const data: TierResultFile = {
    tier: 't3_crawl4ai',
    timestamp: new Date().toISOString(),
    results,
    stats: { total: apartments.length, succeeded, failed },
  };
  saveTierResults('t3_crawl4ai.json', data);
  console.log(`\n=== T3 Summary: ${succeeded} succeeded, ${failed} failed out of ${apartments.length} ===`);
}

async function runTierT4(apartments: Apartment[]) {
  // T4 reads from a pool file
  const poolPath = resolve(TIER_RESULTS_DIR, 't4_pool.json');
  if (!existsSync(poolPath)) {
    console.error(`T4 pool file not found: ${poolPath}`);
    console.error('Create tier_results/t4_pool.json with an array of apartment IDs first.');
    process.exit(1);
  }

  const poolData = JSON.parse(readFileSync(poolPath, 'utf-8'));
  // Pool format: [{id, name, reason}] or {apartmentIds: [...]} or [id, id, ...]
  let rawIds: number[];
  if (Array.isArray(poolData)) {
    rawIds = poolData.map((e: any) => typeof e === 'number' ? e : e.id).filter(Boolean);
  } else {
    rawIds = poolData.apartmentIds || poolData.ids || [];
  }
  const poolIds = new Set<number>(rawIds);
  const poolApartments = apartments.filter(a => poolIds.has(a.id));

  console.log(`\n=== T4 AI+Playwright — ${poolApartments.length} apartments (from pool of ${poolIds.size}) ===\n`);
  // NOTE: Run with --expose-gc for memory management: node --expose-gc -r tsx/cjs scripts/scrape.ts --tier t4

  const results: Record<string, TierResultEntry> = {};
  let succeeded = 0;
  let failed = 0;

  // Concurrency=1 to prevent Playwright memory crashes
  const CONCURRENCY = 1;

  await mapConcurrent(poolApartments, CONCURRENCY, async (apt, i) => {
    console.log(`[${i + 1}/${poolApartments.length}] ${apt.name} (ID: ${apt.id})`);
    try {
      const plans = await scrapeWithAIPlaywright({ id: apt.id, websiteUrl: apt.website_url });
      if (plans && plans.length > 0) {
        const valid = validateFloorPlans(plans);
        if (valid.length > 0) {
          console.log(`  ✓ ${valid.length} floor plans`);
          results[String(apt.id)] = {
            apartmentId: apt.id,
            name: apt.name,
            url: apt.website_url,
            plans: valid,
          };
          succeeded++;
        } else {
          console.log('  ✗ All plans rejected by validation');
          failed++;
        }
      } else {
        console.log('  ✗ No results');
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Error: ${(err as Error).message}`);
      failed++;
    }

    // Memory management: force GC every 10 apartments
    if ((i + 1) % 10 === 0) {
      console.log(`  [memory] Processed ${i + 1}/${poolApartments.length}, forcing GC...`);
      if (global.gc) global.gc();
    }
  });

  const data: TierResultFile = {
    tier: 't4_ai_playwright',
    timestamp: new Date().toISOString(),
    results,
    stats: { total: poolApartments.length, succeeded, failed },
  };
  saveTierResults('t4_ai_playwright.json', data);
  console.log(`\n=== T4 Summary: ${succeeded} succeeded, ${failed} failed out of ${poolApartments.length} ===`);
}

// --- Legacy mode (no --tier flag): all tiers sequentially per apartment ---

async function runLegacy() {
  // --fast flag: skip slow tiers for a quick first pass
  const fastMode = process.argv.includes('--fast');
  const tiers = fastMode
    ? allTiers.filter(t => t.name === 'rentcafe' || t.name === 'cheerio')
    : allTiers;

  // Ensure last_successful_tier column exists
  try {
    await db.execute('ALTER TABLE apartments ADD COLUMN last_successful_tier TEXT');
  } catch {
    // Column already exists, ignore
  }

  // --pending-only flag: skip already-active apartments (for retry runs)
  const pendingOnly = process.argv.includes('--pending-only');
  const query = pendingOnly
    ? "SELECT id, name, website_url, scrape_status, last_successful_tier FROM apartments WHERE scrape_status = 'pending'"
    : "SELECT id, name, website_url, scrape_status, last_successful_tier FROM apartments WHERE scrape_status != 'broken'";
  const result = await db.execute(query);

  const apartments = result.rows as unknown as Apartment[];
  console.log(`Found ${apartments.length} apartments to scrape.\n`);

  let succeeded = 0;
  let failed = 0;
  let broken = 0;

  const CONCURRENCY = 2;

  await mapConcurrent(apartments, CONCURRENCY, async (apt, i) => {
    console.log(`[${i + 1}/${apartments.length}] ${apt.name} (ID: ${apt.id})`);

    const startTime = Date.now();
    let plans: ScrapedFloorPlan[] | null = null;
    let usedTier: string | null = null;

    // Build tier order: try last successful tier first, then all others
    let orderedTiers = tiers;
    if (apt.last_successful_tier) {
      const lastTier = tiers.find(t => t.name === apt.last_successful_tier);
      if (lastTier) {
        orderedTiers = [lastTier, ...tiers.filter(t => t.name !== apt.last_successful_tier)];
      }
    }

    for (const tier of orderedTiers) {
      try {
        console.log(`  Trying ${tier.name}...`);
        plans = await tier.fn({ id: apt.id, websiteUrl: apt.website_url });
        if (plans && plans.length > 0) {
          usedTier = tier.name;
          break;
        }
      } catch (err) {
        console.log(`  ${tier.name} failed: ${(err as Error).message}`);
      }
    }

    const durationMs = Date.now() - startTime;

    if (plans && plans.length > 0) {
      console.log(`  ✓ Got ${plans.length} floor plans via ${usedTier} (${durationMs}ms)`);
      succeeded++;

      await upsertFloorPlans(apt.id, plans);

      await db.execute({
        sql: `UPDATE apartments SET last_scraped_at = datetime('now'), scrape_status = 'active', last_successful_tier = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [usedTier, apt.id],
      });

      try {
        const amenities = await scrapeAmenitiesFromUrl(apt.website_url);
        if (amenities) {
          await db.execute({
            sql: `UPDATE apartments SET
              has_in_unit_wd = ?, has_dishwasher = ?, has_parking = ?,
              has_gym = ?, has_pool = ?, pet_friendly = ?
              WHERE id = ?`,
            args: [
              amenities.hasInUnitWd ? 1 : 0,
              amenities.hasDishwasher ? 1 : 0,
              amenities.hasParking ? 1 : 0,
              amenities.hasGym ? 1 : 0,
              amenities.hasPool ? 1 : 0,
              amenities.petFriendly ? 1 : 0,
              apt.id,
            ],
          });
        }
      } catch (err) {
        console.log(`  [amenities] Failed for ${apt.name}: ${(err as Error).message}`);
      }

      await logScrape(apt.id, 'success', durationMs);
    } else {
      console.log(`  ✗ All tiers failed (${durationMs}ms)`);
      failed++;

      await logScrape(apt.id, 'error', durationMs, 'All scraper tiers failed');

      const consecutiveFailures = await getConsecutiveFailures(apt.id);
      if (consecutiveFailures >= 3) {
        console.log(`  ⚠ Marking as broken (${consecutiveFailures} consecutive failures)`);
        broken++;
        await db.execute({
          sql: `UPDATE apartments SET scrape_status = 'broken', updated_at = datetime('now') WHERE id = ?`,
          args: [apt.id],
        });
      }
    }
  });

  console.log('\n=== Scrape Summary ===');
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Broken:    ${broken}`);
  console.log(`Total:     ${apartments.length}`);
}

// --- Main entry point ---

async function main() {
  console.log('=== AptByBART Scraper ===\n');

  const tierArg = parseTierArg();

  if (!tierArg) {
    // No --tier flag: run legacy all-tiers-per-apartment mode
    await runLegacy();
    return;
  }

  // Per-tier mode: query ALL apartments
  console.log(`Running in per-tier mode: ${tierArg}\n`);
  const result = await db.execute(
    'SELECT id, name, website_url, scrape_status, last_successful_tier FROM apartments'
  );
  const apartments = result.rows as unknown as Apartment[];
  console.log(`Found ${apartments.length} total apartments.\n`);

  switch (tierArg) {
    case 't1':
      await runTierT1(apartments);
      break;
    case 't2':
      await runTierT2(apartments);
      break;
    case 't3':
      await runTierT3(apartments);
      break;
    case 't4':
      await runTierT4(apartments);
      break;
  }
}

main().catch(console.error);
