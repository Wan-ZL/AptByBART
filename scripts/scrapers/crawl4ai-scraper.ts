import { ScrapedFloorPlan } from './rentcafe';

const CRAWL4AI_URL = process.env.CRAWL4AI_URL || 'http://localhost:11235';

interface ChunkedItem {
  index: number;
  tags: string[];
  content: string[];
  error: boolean;
}

/**
 * Parse chunked extraction format from Crawl4AI.
 * Content lines may be split or combined unpredictably, so we join them
 * and extract all patterns from the full text.
 */
function parseChunkedContent(chunks: ChunkedItem[]): ScrapedFloorPlan[] {
  const plans: ScrapedFloorPlan[] = [];
  // Deduplicate by name since Crawl4AI sometimes returns duplicate chunks with different tags
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (chunk.error || !Array.isArray(chunk.content) || chunk.content.length === 0) continue;

    // Join all content lines so patterns work regardless of how text was split
    const text = chunk.content.join(' | ');

    let bedrooms = 0;
    let bathrooms = 1;
    let sqftMin: number | null = null;
    let sqftMax: number | null = null;
    let priceMin: number | null = null;
    let priceMax: number | null = null;
    let availableUnits: number | null = null;

    // Parse "1 BR / 1.0 BA" or "Studio"
    const brBaMatch = text.match(/(\d+)\s*BR\s*\/\s*([\d.]+)\s*BA/i);
    if (brBaMatch) {
      bedrooms = parseInt(brBaMatch[1], 10);
      bathrooms = parseFloat(brBaMatch[2]);
    } else if (/studio/i.test(text)) {
      bedrooms = 0;
    }

    // Parse "694 - 775 sq ft" or "1335 sq ft"
    const sqftRangeMatch = text.match(/([\d,]+)\s*-\s*([\d,]+)\s*sq\s*ft/i);
    if (sqftRangeMatch) {
      sqftMin = parseInt(sqftRangeMatch[1].replace(/,/g, ''), 10);
      sqftMax = parseInt(sqftRangeMatch[2].replace(/,/g, ''), 10);
    } else {
      const sqftSingleMatch = text.match(/([\d,]+)\s*sq\s*ft/i);
      if (sqftSingleMatch) {
        const val = parseInt(sqftSingleMatch[1].replace(/,/g, ''), 10);
        sqftMin = val;
        sqftMax = val;
      }
    }

    // Parse prices: "from $3,096", "$3,096 - $3,500", "Base Rent $3,090"
    const priceRangeMatch = text.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
    if (priceRangeMatch) {
      priceMin = parseInt(priceRangeMatch[1].replace(/,/g, ''), 10);
      priceMax = parseInt(priceRangeMatch[2].replace(/,/g, ''), 10);
    } else {
      const basePriceMatch = text.match(/Base\s*Rent\s*\$([\d,]+)/i);
      if (basePriceMatch) {
        priceMin = parseInt(basePriceMatch[1].replace(/,/g, ''), 10);
      }
      const fromPriceMatch = text.match(/from\s*\$([\d,]+)/i);
      if (fromPriceMatch) {
        const val = parseInt(fromPriceMatch[1].replace(/,/g, ''), 10);
        if (priceMax === null) priceMax = val;
        if (priceMin === null) priceMin = val;
      }
    }

    // Parse availability
    const availMatch = text.match(/(\d+)\s*[Aa]vailable/);
    if (availMatch) {
      availableUnits = parseInt(availMatch[1], 10);
    } else if (/contact for|no units/i.test(text)) {
      availableUnits = 0;
    }

    // Extract name: first content element, stripped of BR/BA/sqft/price patterns
    let name: string | null = chunk.content[0]
      .replace(/\d+\s*BR\s*\/\s*[\d.]+\s*BA/i, '')
      .replace(/[\d,]+\s*-\s*[\d,]+\s*sq\s*ft/i, '')
      .replace(/[\d,]+\s*sq\s*ft/i, '')
      .replace(/from\s*\$[\d,]+/i, '')
      .replace(/\$[\d,]+/g, '')
      .replace(/[,|]+/g, ' ')
      .trim() || null;

    // Skip duplicates
    if (name && seen.has(name)) continue;
    if (name) seen.add(name);

    plans.push({
      name,
      bedrooms,
      bathrooms,
      sqftMin,
      sqftMax,
      priceMin,
      priceMax,
      availableUnits,
    });
  }

  return plans;
}

// Common sub-page paths where floor plans / pricing live
// Only the 3 sub-paths that actually produce results (based on data)
const SUBPAGE_PATHS = [
  '/floorplans',
  '/floor-plans',
  '/floor_plans',
];

async function crawlUrl(url: string): Promise<ScrapedFloorPlan[] | null> {
  try {
  const res = await fetch(`${CRAWL4AI_URL}/md`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
        f: 'llm',
        q: `You are extracting apartment floor plan data from a rental property website.
Extract ALL floor plans/unit types with their pricing information.
Return a JSON array of objects with these exact fields:
- name (string or null): floor plan or unit type name
- bedrooms (number): number of bedrooms, 0 for studio
- bathrooms (number): number of bathrooms
- sqftMin (number or null): minimum square footage
- sqftMax (number or null): maximum square footage
- priceMin (number or null): minimum monthly rent in USD (just the number, no $ sign)
- priceMax (number or null): maximum monthly rent in USD
- availableUnits (number or null): number of available units

Rules:
- Only extract prices explicitly stated on the page
- Prices should be monthly rent in USD, typically $1,000-$10,000 for Bay Area
- If price says "Call for pricing" or similar, set priceMin and priceMax to null
- Return an empty array [] if no floor plan data is found
- Return ONLY the JSON array, no explanation

Example output:
[{"name":"Studio A","bedrooms":0,"bathrooms":1,"sqftMin":450,"sqftMax":500,"priceMin":2100,"priceMax":2400,"availableUnits":3}]`,
        provider: 'openai/gpt-4o',
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.log(`  [crawl4ai] API error ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();

    if (!data?.success) {
      console.log(`  [crawl4ai] Crawl failed: ${data?.error || 'unknown'}`);
      return null;
    }

    const extractedContent = data.extracted_content;
    if (!extractedContent) {
      console.log('  [crawl4ai] No extracted content in response');
      return null;
    }

    // extracted_content is a JSON string from the LLM
    const contentStr = typeof extractedContent === 'string'
      ? extractedContent
      : JSON.stringify(extractedContent);

    // Try to parse the content
    let parsed: any[];
    try {
      parsed = JSON.parse(contentStr);
    } catch {
      // Try extracting a JSON array from the string
      const jsonMatch = contentStr.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.log('  [crawl4ai] No JSON array in extracted content');
        return null;
      }
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.log('  [crawl4ai] Failed to parse JSON from extracted content');
        return null;
      }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.log('  [crawl4ai] Empty result array');
      return null;
    }

    // Detect format: chunked ({index, tags, content}) vs direct floor plan objects
    let plans: ScrapedFloorPlan[];

    if (parsed[0]?.content && Array.isArray(parsed[0].content)) {
      // Chunked extraction format — parse the content arrays
      plans = parseChunkedContent(parsed as ChunkedItem[]);
    } else {
      // Direct JSON objects from LLM
      plans = [];
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue;
        plans.push({
          name: item.name ?? null,
          bedrooms: typeof item.bedrooms === 'number' ? item.bedrooms : 0,
          bathrooms: typeof item.bathrooms === 'number' ? item.bathrooms : 1,
          sqftMin: typeof item.sqftMin === 'number' ? item.sqftMin : null,
          sqftMax: typeof item.sqftMax === 'number' ? item.sqftMax : null,
          priceMin: typeof item.priceMin === 'number' ? item.priceMin : null,
          priceMax: typeof item.priceMax === 'number' ? item.priceMax : null,
          availableUnits: typeof item.availableUnits === 'number' ? item.availableUnits : null,
        });
      }
    }

    if (plans.length === 0) return null;

    return plans;
  } catch (err) {
    console.log(`  [crawl4ai] Error crawling ${url}: ${(err as Error).message}`);
    return null;
  }
}

export async function scrapeWithCrawl4AI(
  apartment: { id: number; websiteUrl: string }
): Promise<ScrapedFloorPlan[] | null> {
  // Build list of URLs to try: homepage + common sub-page paths
  const baseUrl = apartment.websiteUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const origin = new URL(baseUrl).origin;

  const urlsToTry = [baseUrl];
  for (const path of SUBPAGE_PATHS) {
    urlsToTry.push(`${origin}${path}`);
  }

  // Try homepage first
  console.log(`  [crawl4ai] Trying homepage: ${baseUrl}`);
  const homepageResult = await crawlUrl(baseUrl);
  if (homepageResult && homepageResult.length > 0) {
    console.log(`  [crawl4ai] Extracted ${homepageResult.length} floor plans from homepage`);
    return homepageResult;
  }

  // Try sub-pages in parallel (batch of 3 to avoid overloading)
  console.log(`  [crawl4ai] Homepage empty, trying ${SUBPAGE_PATHS.length} sub-pages...`);
  for (let i = 0; i < SUBPAGE_PATHS.length; i += 3) {
    const batch = urlsToTry.slice(i + 1, i + 4); // +1 to skip homepage already tried
    const results = await Promise.all(batch.map(url => crawlUrl(url)));
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result && result.length > 0) {
        console.log(`  [crawl4ai] Extracted ${result.length} floor plans from ${batch[j]}`);
        return result;
      }
    }
  }

  console.log('  [crawl4ai] No floor plans found on any page');
  return null;
}
