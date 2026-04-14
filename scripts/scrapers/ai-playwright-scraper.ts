import { chromium } from 'playwright';
import { ScrapedFloorPlan } from './rentcafe';

// Read at call time, not module load time (env is loaded in scrape.ts after imports)
function getOpenAIKey(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

interface GPTResponse {
  action: 'extract' | 'click' | 'no_data';
  floorPlans?: ScrapedFloorPlan[];
  amenities?: {
    hasInUnitWd?: boolean;
    hasDishwasher?: boolean;
    hasParking?: boolean;
    hasGym?: boolean;
    hasPool?: boolean;
    petFriendly?: boolean;
  };
  clickTarget?: string;
  reasoning?: string;
}

// Extended result that includes both floor plans and amenities
export interface AIScraperResult {
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

export async function scrapeWithAIPlaywright(
  apartment: { id: number; websiteUrl: string }
): Promise<ScrapedFloorPlan[] | null> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    console.log('  [ai-playwright] OPENAI_API_KEY not set, skipping');
    return null;
  }

  let browser: any = null;
  // Hard timeout: 5 minutes for 10 rounds across 2 phases
  const killTimeout = setTimeout(() => {
    if (browser) {
      console.log('  [ai-playwright] Hard timeout (300s) reached, killing browser');
      browser.close().catch(() => {});
      browser = null;
    }
  }, 300_000);

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
    });

    // Stealth init to avoid bot detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      (window as any).chrome = {
        runtime: { id: 'fake', connect: () => {}, sendMessage: () => {} },
        loadTimes: () => ({ commitLoadTime: Date.now() / 1000 }),
        csi: () => ({ startE: Date.now(), onloadT: Date.now() }),
      };
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    });

    const page = await context.newPage();

    // Block media for performance but keep images (AI needs to see the page)
    await page.route('**/*', (route: any) => {
      const type = route.request().resourceType();
      if (type === 'media') return route.abort();
      return route.continue();
    });

    console.log(`  [ai-playwright] Navigating to ${apartment.websiteUrl}`);
    await page.goto(apartment.websiteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Handle Cloudflare challenge
    const isCloudflare = await page.evaluate(() =>
      document.title.includes('Just a moment') || document.title.includes('Checking your browser')
    );
    if (isCloudflare) {
      console.log('  [ai-playwright] Cloudflare detected, waiting...');
      try {
        await page.waitForFunction(() =>
          !document.title.includes('Just a moment') && !document.title.includes('Checking your browser'),
          { timeout: 15000 }
        );
        await page.waitForTimeout(2000);
      } catch {
        console.log('  [ai-playwright] Cloudflare challenge failed');
        await page.close().catch(() => {});
        return null;
      }
    }

    // Wait longer for JS to fully render (5s instead of 2s)
    await page.waitForTimeout(4000 + Math.random() * 2000);

    // === PHASE A: Find floor plans + pricing (max 5 rounds) ===
    console.log('  [ai-playwright] Phase A: Finding floor plans + pricing');
    let extractedPlans: ScrapedFloorPlan[] | null = null;
    let extractedAmenities: GPTResponse['amenities'] | undefined;

    for (let round = 0; round < 5; round++) {
      console.log(`  [ai-playwright] A${round + 1}/5`);
      const result = await doRound(page, round, apiKey, 'pricing');
      if (!result) { break; }
      if (result.action === 'extract' && result.floorPlans?.length) {
        extractedPlans = result.floorPlans;
        if (result.amenities) extractedAmenities = result.amenities;
        console.log(`  [ai-playwright] ✓ Phase A: ${extractedPlans.length} floor plans`);
        break;
      }
      if (result.action === 'no_data') { break; }
      if (result.action === 'click') {
        const clicked = await tryClick(page, result.clickTarget || '');
        if (!clicked) console.log(`  [ai-playwright] Click failed: ${result.clickTarget}`);
      }
    }

    // === PHASE B: Find amenities (max 5 rounds, reuse same browser) ===
    console.log('  [ai-playwright] Phase B: Finding amenities');
    // Navigate back to homepage for amenity search
    try {
      const baseUrl = apartment.websiteUrl.replace(/[?#].*$/, '');
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
    } catch {
      console.log('  [ai-playwright] Failed to navigate back for amenities');
    }

    for (let round = 0; round < 5; round++) {
      console.log(`  [ai-playwright] B${round + 1}/5`);
      const result = await doRound(page, round, apiKey, 'amenities');
      if (!result) { break; }
      if (result.action === 'extract' && result.amenities) {
        // Merge amenities (union with any from Phase A)
        extractedAmenities = {
          hasInUnitWd: result.amenities.hasInUnitWd || extractedAmenities?.hasInUnitWd || false,
          hasDishwasher: result.amenities.hasDishwasher || extractedAmenities?.hasDishwasher || false,
          hasParking: result.amenities.hasParking || extractedAmenities?.hasParking || false,
          hasGym: result.amenities.hasGym || extractedAmenities?.hasGym || false,
          hasPool: result.amenities.hasPool || extractedAmenities?.hasPool || false,
          petFriendly: result.amenities.petFriendly || extractedAmenities?.petFriendly || false,
        };
        console.log(`  [ai-playwright] ✓ Phase B: amenities found`);
        break;
      }
      if (result.action === 'no_data') { break; }
      if (result.action === 'click') {
        const clicked = await tryClick(page, result.clickTarget || '');
        if (!clicked) console.log(`  [ai-playwright] Click failed: ${result.clickTarget}`);
      }
    }

    await page.close().catch(() => {});

    if (!extractedPlans || extractedPlans.length === 0) {
      console.log('  [ai-playwright] No floor plans found');
      return null;
    }

    // Stash amenities on the plans for the caller to use
    // (hacky but avoids changing ScraperFn signature — amenities stored as side effect)
    (extractedPlans as any).__amenities = extractedAmenities;
    return extractedPlans;
  } catch (err) {
    console.log(`  [ai-playwright] Error: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(killTimeout);
    if (browser) await browser.close().catch(() => {});
  }
}

// Single round: screenshot → GPT → return action
async function doRound(
  page: any, round: number, apiKey: string, phase: 'pricing' | 'amenities'
): Promise<GPTResponse | null> {
  let screenshotBuffer: Buffer | null = await page.screenshot({ type: 'jpeg', quality: 70 });
  const base64Screenshot = screenshotBuffer!.toString('base64');
  screenshotBuffer = null;

  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '');
  const pageUrl = page.url();

  return askGPT4o(base64Screenshot, pageText, pageUrl, round, apiKey, phase);
}

// Try clicking a target with multiple fallback strategies
async function tryClick(page: any, rawTarget: string): Promise<boolean> {
  if (rawTarget.toLowerCase() === 'wait') {
    await page.waitForTimeout(5000);
    return true;
  }

  const target = rawTarget
    .replace(/^(click |tap |press |select |the |a )/i, '')
    .replace(/ (button|link|tab|menu|icon|element|section|nav|navigation)$/i, '')
    .trim();

  // Try role-based click
  try {
    await page.getByRole('link', { name: target }).or(page.getByRole('button', { name: target })).first().click({ timeout: 5000 });
    console.log(`  [ai-playwright] Clicked: ${target}`);
    await page.waitForTimeout(2000 + Math.random() * 1000);
    return true;
  } catch {}
  // getByText
  try {
    await page.getByText(target, { exact: false }).first().click({ timeout: 5000 });
    console.log(`  [ai-playwright] Clicked: ${target}`);
    await page.waitForTimeout(2000);
    return true;
  } catch {}
  // aria-label
  try {
    await page.locator(`[aria-label*="${target}" i]`).first().click({ timeout: 5000 });
    console.log(`  [ai-playwright] Clicked: ${target}`);
    await page.waitForTimeout(2000);
    return true;
  } catch {}
  // CSS selector
  if (/^[a-z.#\[]/.test(target)) {
    try {
      await page.click(target, { timeout: 5000 });
      console.log(`  [ai-playwright] Clicked: ${target}`);
      await page.waitForTimeout(2000);
      return true;
    } catch {}
  }
  // Last resort: text=
  try {
    await page.locator(`text=${target}`).first().click({ timeout: 5000 });
    console.log(`  [ai-playwright] Clicked: ${target}`);
    await page.waitForTimeout(2000);
    return true;
  } catch {}

  return false;
}

async function askGPT4o(
  screenshotBase64: string,
  pageText: string,
  pageUrl: string,
  round: number,
  apiKey: string,
  phase: 'pricing' | 'amenities' = 'pricing'
): Promise<GPTResponse | null> {
  const systemPrompt = `You are an expert web scraper assistant. You analyze apartment rental website screenshots to find floor plan/pricing information.

STEP 1 — CLEAR OBSTACLES FIRST:
Before anything else, check if the page has any of these blockers:
- Popup, modal, or overlay (cookie consent, newsletter signup, chat widget) → click "X", "Close", "Accept", "Dismiss", "Got it", or "No thanks"
- Cloudflare "Verify you are human" → say no_data (we cannot solve CAPTCHAs)
- "Loading..." or spinner still visible → say "click" with clickTarget "wait" (I will wait and retry)

STEP 2 — FIND DATA OR NAVIGATE:
After obstacles are cleared:
1. If floor plan pricing data is visible (unit types, bedrooms, prices/rent), extract it
2. If NOT visible, navigate to it:
   - If you see a hamburger menu (☰ or three lines icon) → open it FIRST, then look for Floor Plans link
   - Look for links/buttons: "Floor Plans", "Pricing", "Availability", "Units", "Apartments", "View Plans"
   - Also check tabs, sidebar links, or footer navigation
3. If no useful data and no navigation to pricing, say no_data

IMPORTANT:
- clickTarget must be SHORT — just the button/link text, e.g. "Floor Plans" or "Close" or "Accept All"
- Do NOT include explanations in clickTarget — just the text to click
- Prices are monthly rent in USD (typically $1,000-$10,000 range for Bay Area)
- Studio = 0 bedrooms
- Also extract amenities if visible: in-unit washer/dryer, dishwasher, parking, gym/fitness, pool, pet-friendly`;

  let userPrompt: string;

  if (phase === 'amenities') {
    // Phase B: looking for amenities
    userPrompt = round === 0
      ? `This is an apartment rental website at ${pageUrl}. I need to find the AMENITIES page.

Look for links/buttons: "Amenities", "Features", "Community", "About", or similar.
If you can already see amenity information (gym, pool, parking, washer/dryer, dishwasher, pet policy), extract it.

Page text (first 5000 chars):
${pageText}

Respond with JSON only (no markdown fences):
{
  "action": "extract" | "click" | "no_data",
  "amenities": {"hasInUnitWd": false, "hasDishwasher": true, "hasParking": true, "hasGym": true, "hasPool": false, "petFriendly": true},
  "clickTarget": "button text to click",
  "reasoning": "brief explanation"
}`
      : `I clicked on the element you suggested. Here's the new page at ${pageUrl}.

Can you see amenity information now? Look for: in-unit washer/dryer, dishwasher, parking/garage, gym/fitness, pool/swimming, pet-friendly.
If yes, extract amenities. If not, what else should I click? If nothing useful, say no_data.

Page text:
${pageText}

Respond with JSON only:
{
  "action": "extract" | "click" | "no_data",
  "amenities": {"hasInUnitWd": false, "hasDishwasher": false, "hasParking": false, "hasGym": false, "hasPool": false, "petFriendly": false},
  "clickTarget": "...",
  "reasoning": "..."
}`;
  } else {
    // Phase A: looking for floor plans + pricing
    userPrompt = round === 0
      ? `This is an apartment rental website at ${pageUrl}. Analyze this page:

1. Is there floor plan/pricing data visible (apartment names, bedrooms, bathrooms, rent prices, square footage)?
2. If YES: Extract ALL floor plans as JSON. Also extract any visible amenities.
3. If NO: What button/link/element should I click to find floor plans or pricing?

Page text (first 5000 chars):
${pageText}

Respond with JSON only (no markdown fences):
{
  "action": "extract" | "click" | "no_data",
  "floorPlans": [{"name": "...", "bedrooms": 0, "bathrooms": 1, "sqftMin": null, "sqftMax": null, "priceMin": 2500, "priceMax": null, "availableUnits": null}],
  "amenities": {"hasInUnitWd": false, "hasDishwasher": false, "hasParking": false, "hasGym": false, "hasPool": false, "petFriendly": false},
  "clickTarget": "button text to click",
  "reasoning": "brief explanation"
}`
      : `I clicked on the element you suggested. Here's the new page at ${pageUrl}.

Is floor plan/pricing data visible now? If yes, extract it (and any visible amenities). If not, what else should I click? If nothing useful, say no_data.

Page text:
${pageText}

Respond with JSON only:
{
  "action": "extract" | "click" | "no_data",
  "floorPlans": [...],
  "amenities": {"hasInUnitWd": false, "hasDishwasher": false, "hasParking": false, "hasGym": false, "hasPool": false, "petFriendly": false},
  "clickTarget": "...",
  "reasoning": "..."
}`;
  }

  try {
    // GPT-5.4 uses the Responses API (not Chat Completions)
    const response = await fetch('https://api.openai.com/v1/responses', {
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
          {
            role: 'user',
            content: [
              { type: 'input_image', image_url: `data:image/jpeg;base64,${screenshotBase64}` },
              { type: 'input_text', text: userPrompt },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.log(`  [ai-playwright] GPT API error ${response.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    // GPT-5.4 Responses API: output is an array, find the message item
    let content = '';
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === 'output_text' && c.text) {
              content = c.text;
              break;
            }
          }
          if (content) break;
        }
      }
    }

    if (!content) {
      console.log('  [ai-playwright] Empty GPT response');
      return null;
    }

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('  [ai-playwright] No JSON in response:', content.slice(0, 150));
      return null;
    }

    return JSON.parse(jsonMatch[0]) as GPTResponse;
  } catch (err) {
    console.log(`  [ai-playwright] GPT request error: ${(err as Error).message}`);
    return null;
  }
}
