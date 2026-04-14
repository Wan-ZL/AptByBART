import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

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

interface MergedApartment {
  id: number;
  name: string;
  needsT4: boolean;
  plans: {
    name: string | null;
    bedrooms: number;
    bathrooms: number;
    sqftMin: number | null;
    sqftMax: number | null;
    priceMin: number | null;
    priceMax: number | null;
    availableUnits: number | null;
  }[];
}

interface T4PoolEntry {
  id: number;
  name: string;
  reason: string;
}

interface ReviewResult {
  id: number;
  status: 'OK' | 'SUSPICIOUS' | 'NEEDS_VERIFY';
  reason?: string;
}

const TIER_RESULTS_DIR = resolve(__dirname, '..', 'tier_results');
const MERGED_PATH = resolve(TIER_RESULTS_DIR, 'merged.json');
const T4_POOL_PATH = resolve(TIER_RESULTS_DIR, 't4_pool.json');
const BATCH_SIZE = 25;
const MAX_RETRIES = 3;

async function callGPT(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
        input: [
          { role: 'developer', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (res.status === 429) {
      const waitSec = attempt * 30;
      console.log(`  Rate limited (429), waiting ${waitSec}s before retry ${attempt}/${MAX_RETRIES}...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`GPT API error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();

    // Extract text from Responses API: data.output[] → find type 'message' → content[0].text
    const messageItem = data.output?.find((item: { type: string }) => item.type === 'message');
    const text: string = messageItem?.content?.[0]?.text ?? '';
    if (!text) throw new Error('Empty response from GPT');
    return text;
  }

  throw new Error(`Failed after ${MAX_RETRIES} retries (rate limited)`);
}

function parseReviewResponse(text: string): ReviewResult[] {
  // Extract JSON array from response (handle markdown wrapping)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.log('  Warning: could not find JSON array in GPT response');
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: Number(item.id),
        status: (['OK', 'SUSPICIOUS', 'NEEDS_VERIFY'].includes(item.status as string)
          ? item.status
          : 'NEEDS_VERIFY') as ReviewResult['status'],
        reason: typeof item.reason === 'string' ? item.reason : undefined,
      }));
  } catch (err) {
    console.log(`  Warning: failed to parse GPT response JSON: ${(err as Error).message}`);
    return [];
  }
}

const SYSTEM_PROMPT = `You are a data quality reviewer for apartment rental listings in the San Francisco Bay Area.
Review each apartment's scraped data and flag issues.`;

function buildUserPrompt(batch: MergedApartment[]): string {
  const listings = batch.map(apt => ({
    id: apt.id,
    name: apt.name,
    plans: apt.plans.map(p => ({
      name: p.name,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      sqftMin: p.sqftMin,
      sqftMax: p.sqftMax,
      priceMin: p.priceMin,
      priceMax: p.priceMax,
      availableUnits: p.availableUnits,
    })),
  }));

  return `Review these apartment listings. For each, check:
1. Are the prices reasonable for Bay Area? (Monthly rent $1,000-$10,000 is normal)
2. Do bedroom counts match the prices? (Studios ~$1,500-$3,000, 1BR ~$2,000-$4,000, 2BR ~$3,000-$6,000)
3. Is any data clearly wrong? (e.g., $87,877 rent, 0 bedrooms with $5,000 price)
4. Are there floor plans with names that look like non-apartment data? (cookies, tracking categories)

For each apartment, respond with:
- "OK" if data looks correct
- "SUSPICIOUS" + reason if something looks wrong
- "NEEDS_VERIFY" if you're unsure

Respond as JSON array:
[{"id": 123, "status": "OK"}, {"id": 456, "status": "SUSPICIOUS", "reason": "price $500 too low for SF"}, ...]

Apartments to review:
${JSON.stringify(listings, null, 2)}`;
}

async function main() {
  console.log('=== GPT Review: Data Quality Check ===\n');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY not set in .env.local or environment');
    process.exit(1);
  }

  if (!existsSync(MERGED_PATH)) {
    console.error(`Error: ${MERGED_PATH} not found. Run merge-results.ts first.`);
    process.exit(1);
  }

  // Load merged data — format: { apartments: { [id]: {...} }, stats: {...} }
  const mergedRaw = JSON.parse(readFileSync(MERGED_PATH, 'utf-8'));
  const mergedObj = mergedRaw.apartments || mergedRaw;
  const merged: MergedApartment[] = Object.values(mergedObj);

  // Filter to apartments that have plans (needsT4 = false)
  const withPlans = merged.filter(apt => !apt.needsT4 && apt.plans && apt.plans.length > 0);
  console.log(`Total merged: ${merged.length}, with plans to review: ${withPlans.length}\n`);

  if (withPlans.length === 0) {
    console.log('No apartments with plans to review.');
    return;
  }

  // Load existing T4 pool — format: { apartmentIds: [...], reasons: {...} }
  let t4Pool: T4PoolEntry[] = [];
  let existingT4Ids = new Set<number>();
  if (existsSync(T4_POOL_PATH)) {
    const raw = JSON.parse(readFileSync(T4_POOL_PATH, 'utf-8'));
    if (raw.apartmentIds && raw.reasons) {
      // Convert { apartmentIds: [1,2], reasons: {"1": "no_plans"} } to T4PoolEntry[]
      for (const id of raw.apartmentIds) {
        t4Pool.push({ id, name: '', reason: raw.reasons[String(id)] || 'unknown' });
        existingT4Ids.add(id);
      }
    } else if (Array.isArray(raw)) {
      t4Pool = raw;
      existingT4Ids = new Set(raw.map((e: any) => e.id));
    }
  }
  console.log(`Existing T4 pool: ${existingT4Ids.size} apartments\n`);

  // Batch apartments
  const batches: MergedApartment[][] = [];
  for (let i = 0; i < withPlans.length; i += BATCH_SIZE) {
    batches.push(withPlans.slice(i, i + BATCH_SIZE));
  }

  let okCount = 0;
  let suspiciousCount = 0;
  let needsVerifyCount = 0;
  let errorCount = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`Batch ${b + 1}/${batches.length} (${batch.length} apartments)...`);

    try {
      const userPrompt = buildUserPrompt(batch);
      const responseText = await callGPT(apiKey, SYSTEM_PROMPT, userPrompt);
      const results = parseReviewResponse(responseText);

      for (const result of results) {
        if (result.status === 'OK') {
          okCount++;
        } else if (result.status === 'SUSPICIOUS') {
          suspiciousCount++;
          const apt = batch.find(a => a.id === result.id);
          if (apt && !existingT4Ids.has(result.id)) {
            t4Pool.push({ id: result.id, name: apt.name, reason: `GPT review: ${result.reason ?? 'suspicious data'}` });
            existingT4Ids.add(result.id);
          }
          console.log(`  SUSPICIOUS #${result.id}: ${result.reason ?? 'no reason given'}`);
        } else {
          needsVerifyCount++;
          const apt = batch.find(a => a.id === result.id);
          if (apt && !existingT4Ids.has(result.id)) {
            t4Pool.push({ id: result.id, name: apt.name, reason: `GPT review: needs verification` });
            existingT4Ids.add(result.id);
          }
          console.log(`  NEEDS_VERIFY #${result.id}: ${result.reason ?? 'uncertain'}`);
        }
      }

      // Count apartments in batch that GPT didn't return results for
      const reviewedIds = new Set(results.map(r => r.id));
      const missed = batch.filter(a => !reviewedIds.has(a.id));
      if (missed.length > 0) {
        console.log(`  Warning: GPT skipped ${missed.length} apartments in this batch`);
        errorCount += missed.length;
      }
    } catch (err) {
      console.log(`  Error on batch ${b + 1}: ${(err as Error).message}`);
      errorCount += batch.length;
    }
  }

  // Write updated T4 pool
  writeFileSync(T4_POOL_PATH, JSON.stringify(t4Pool, null, 2));

  console.log('\n=== GPT Review Summary ===');
  console.log(`OK:           ${okCount}`);
  console.log(`Suspicious:   ${suspiciousCount}`);
  console.log(`Needs Verify: ${needsVerifyCount}`);
  console.log(`Errors:       ${errorCount}`);
  console.log(`T4 pool size: ${t4Pool.length}`);
}

main().catch(console.error);
