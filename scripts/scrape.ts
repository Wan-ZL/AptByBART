import { readFileSync } from 'fs';
import { resolve } from 'path';
import { db } from '../db/client';
import { scrapeRentCafe, ScrapedFloorPlan } from './scrapers/rentcafe';
import { scrapeWithCheerio } from './scrapers/http-cheerio';
import { scrapeWithPlaywright } from './scrapers/playwright-scraper';
import { scrapeWithOpenAI } from './scrapers/openai-fallback';
import { scrapeWithClaude } from './scrapers/claude-fallback';

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

const tiers: { name: string; fn: ScraperFn }[] = [
  { name: 'rentcafe', fn: scrapeRentCafe },
  { name: 'cheerio', fn: scrapeWithCheerio },
  { name: 'playwright', fn: scrapeWithPlaywright },
  { name: 'openai', fn: scrapeWithOpenAI },
  { name: 'claude', fn: scrapeWithClaude },
];

// Sanitize a numeric value: replace Infinity, NaN, or undefined with null
function finiteOrNull(val: number | null | undefined): number | null {
  if (val == null || !Number.isFinite(val)) return null;
  return val;
}

async function upsertFloorPlans(apartmentId: number, plans: ScrapedFloorPlan[]) {
  // Delete existing floor plans for this apartment, then insert fresh ones
  await db.execute({
    sql: 'DELETE FROM floor_plans WHERE apartment_id = ?',
    args: [apartmentId],
  });

  for (const plan of plans) {
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

    // Insert price history for this floor plan
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

async function main() {
  console.log('=== AptByBART Scraper ===\n');

  // Ensure last_successful_tier column exists
  try {
    await db.execute('ALTER TABLE apartments ADD COLUMN last_successful_tier TEXT');
  } catch {
    // Column already exists, ignore
  }

  // Fetch apartments that are not broken
  const result = await db.execute(
    "SELECT id, name, website_url, scrape_status, last_successful_tier FROM apartments WHERE scrape_status != 'broken'"
  );

  const apartments = result.rows as unknown as Apartment[];
  console.log(`Found ${apartments.length} apartments to scrape.\n`);

  let succeeded = 0;
  let failed = 0;
  let broken = 0;

  const CONCURRENCY = 5;

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

    // Try tiers in order
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

      await logScrape(apt.id, 'success', durationMs);
    } else {
      console.log(`  ✗ All tiers failed (${durationMs}ms)`);
      failed++;

      await logScrape(apt.id, 'error', durationMs, 'All scraper tiers failed');

      // Check staleness: 3 consecutive failures → mark as broken
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

main().catch(console.error);
