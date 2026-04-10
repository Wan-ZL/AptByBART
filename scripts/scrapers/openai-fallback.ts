import { ScrapedFloorPlan } from './rentcafe';

export async function scrapeWithOpenAI(
  apartment: { id: number; websiteUrl: string }
): Promise<ScrapedFloorPlan[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // Fetch page HTML
  let html: string;
  try {
    const res = await fetch(apartment.websiteUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Strip non-content tags to reduce token count
  html = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s{2,}/g, ' ');

  // Truncate to ~100k chars to stay within token limits
  if (html.length > 100_000) {
    html = html.slice(0, 100_000);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        max_completion_tokens: 4096,
        messages: [
          {
            role: 'system',
            content:
              'You are a data extraction assistant. Extract structured data from HTML. Return ONLY valid JSON, no markdown fences, no explanation.',
          },
          {
            role: 'user',
            content: `Extract apartment floor plans from this HTML. Return ONLY a JSON array of objects with these fields:
- name (string or null): floor plan name
- bedrooms (number): number of bedrooms, 0 for studio
- bathrooms (number): number of bathrooms
- sqftMin (number or null): minimum square footage
- sqftMax (number or null): maximum square footage
- priceMin (number or null): minimum monthly rent in dollars
- priceMax (number or null): maximum monthly rent in dollars
- availableUnits (number or null): number of available units

If no floor plan data is found, return an empty array [].

HTML:
${html}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.log(`  [openai] API error ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';

    // Extract JSON array from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Validate and normalize each plan
    const plans: ScrapedFloorPlan[] = [];
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
        availableUnits:
          typeof item.availableUnits === 'number' ? item.availableUnits : null,
      });
    }

    return plans.length > 0 ? plans : null;
  } catch (err) {
    console.log(`  [openai] Error: ${(err as Error).message}`);
    return null;
  }
}
