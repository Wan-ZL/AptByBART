export interface ScrapedFloorPlan {
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

const RENTCAFE_API_BASE = 'https://api.rentcafe.com/rentcafeapi.aspx';

export function isRentCafe(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('rentcafe.com') || lower.includes('rentcafewebsite.com');
}

interface RentCafeCredentials {
  apiToken: string;
  propertyCode: string;
}

function extractCredentials(html: string): RentCafeCredentials | null {
  // Try direct parameter patterns
  const tokenPatterns = [
    /apiToken[=:]\s*["']?([a-zA-Z0-9_-]+)["']?/i,
    /api_token[=:]\s*["']?([a-zA-Z0-9_-]+)["']?/i,
    /["']apiToken["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/i,
  ];

  const codePatterns = [
    /(?:VoyagerPropertyCode|propertyCode|property_code)[=:]\s*["']?([a-zA-Z0-9_-]+)["']?/i,
    /["'](?:VoyagerPropertyCode|propertyCode)["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/i,
  ];

  let apiToken: string | null = null;
  let propertyCode: string | null = null;

  for (const pattern of tokenPatterns) {
    const match = html.match(pattern);
    if (match) {
      apiToken = match[1];
      break;
    }
  }

  for (const pattern of codePatterns) {
    const match = html.match(pattern);
    if (match) {
      propertyCode = match[1];
      break;
    }
  }

  // Try extracting from RentCafe API URLs embedded in the page
  if (!apiToken || !propertyCode) {
    const urlPattern = /rentcafeapi\.aspx\?[^"']*apiToken=([a-zA-Z0-9_-]+)[^"']*VoyagerPropertyCode=([a-zA-Z0-9_-]+)/i;
    const urlMatch = html.match(urlPattern);
    if (urlMatch) {
      apiToken = apiToken ?? urlMatch[1];
      propertyCode = propertyCode ?? urlMatch[2];
    }
  }

  // Try reverse order in URL
  if (!apiToken || !propertyCode) {
    const urlPattern2 = /rentcafeapi\.aspx\?[^"']*VoyagerPropertyCode=([a-zA-Z0-9_-]+)[^"']*apiToken=([a-zA-Z0-9_-]+)/i;
    const urlMatch2 = html.match(urlPattern2);
    if (urlMatch2) {
      propertyCode = propertyCode ?? urlMatch2[1];
      apiToken = apiToken ?? urlMatch2[2];
    }
  }

  if (apiToken && propertyCode) {
    return { apiToken, propertyCode };
  }

  return null;
}

interface RentCafeFloorPlanResponse {
  FloorplanName?: string;
  FloorplanId?: string;
  Beds?: string | number;
  Baths?: string | number;
  MinimumSQFT?: string | number;
  MaximumSQFT?: string | number;
  MinimumRent?: string | number;
  MaximumRent?: string | number;
  AvailableUnitsCount?: string | number;
  FloorplanImageURL?: string;
  FloorplanHasSpecials?: boolean;
  AvailableDate?: string;
  // The API can return varied field names
  [key: string]: unknown;
}

function parseNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function parseApiResponse(data: RentCafeFloorPlanResponse[]): ScrapedFloorPlan[] {
  const plans: ScrapedFloorPlan[] = [];

  for (const item of data) {
    const name = item.FloorplanName || item.FloorplanId || 'Unknown';
    const bedrooms = Math.round(parseNumber(item.Beds));
    const bathrooms = parseNumber(item.Baths);
    const sqftMin = Math.round(parseNumber(item.MinimumSQFT));
    const sqftMax = Math.round(parseNumber(item.MaximumSQFT)) || sqftMin;
    const priceMin = Math.round(parseNumber(item.MinimumRent));
    const priceMax = Math.round(parseNumber(item.MaximumRent)) || priceMin;
    const availableUnits = Math.round(parseNumber(item.AvailableUnitsCount));

    // Skip floor plans with no pricing data
    if (priceMin === 0 && priceMax === 0) continue;

    const plan: ScrapedFloorPlan = {
      name: String(name),
      bedrooms,
      bathrooms,
      sqftMin,
      sqftMax,
      priceMin,
      priceMax,
      availableUnits,
    };

    if (item.FloorplanImageURL) {
      plan.floorPlanUrl = item.FloorplanImageURL;
    }

    plans.push(plan);
  }

  return plans;
}

async function fetchViaApi(credentials: RentCafeCredentials): Promise<ScrapedFloorPlan[] | null> {
  const url = `${RENTCAFE_API_BASE}?requestType=floorplan&apiToken=${credentials.apiToken}&VoyagerPropertyCode=${credentials.propertyCode}`;

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; AptByBART/1.0)',
    },
  });

  if (!res.ok) {
    console.warn(`[rentcafe] API returned ${res.status} for property ${credentials.propertyCode}`);
    return null;
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    // API sometimes returns an error object
    if (data?.Error) {
      console.warn(`[rentcafe] API error: ${data.Error}`);
      return null;
    }
    console.warn('[rentcafe] Unexpected API response format');
    return null;
  }

  return parseApiResponse(data);
}

function parseHtmlFallback(html: string): ScrapedFloorPlan[] {
  const plans: ScrapedFloorPlan[] = [];

  // Match floor plan cards/sections commonly found on RentCafe pages
  // Look for structured data in common RentCafe HTML patterns
  const floorplanSectionRegex = /<div[^>]*class="[^"]*(?:fp-card|floorplan|floor-plan)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  const sections = html.match(floorplanSectionRegex) || [];

  for (const section of sections) {
    const nameMatch = section.match(/class="[^"]*(?:fp-name|floorplan-name|fpName)[^"]*"[^>]*>([^<]+)/i);
    const bedsMatch = section.match(/(\d+)\s*(?:bed|br|bedroom)/i) || section.match(/studio/i);
    const bathsMatch = section.match(/([\d.]+)\s*(?:bath|ba|bathroom)/i);
    const sqftMatch = section.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft|sf)/i);
    const priceMatch = section.match(/\$\s*([\d,]+)/);

    if (priceMatch) {
      const name = nameMatch?.[1]?.trim() || 'Unknown';
      const bedrooms = bedsMatch?.[0]?.toLowerCase().includes('studio') ? 0 : parseInt(bedsMatch?.[1] || '0');
      const bathrooms = parseFloat(bathsMatch?.[1] || '1');
      const sqft = parseInt((sqftMatch?.[1] || '0').replace(/,/g, ''));
      const price = parseInt(priceMatch[1].replace(/,/g, ''));

      plans.push({
        name,
        bedrooms,
        bathrooms,
        sqftMin: sqft,
        sqftMax: sqft,
        priceMin: price,
        priceMax: price,
        availableUnits: 0,
      });
    }
  }

  // Broader fallback: look for pricing tables/lists
  if (plans.length === 0) {
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows = html.match(rowRegex) || [];

    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length < 3) continue;

      const cellTexts = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
      const priceCell = cellTexts.find(t => t.includes('$'));
      const bedsCell = cellTexts.find(t => /\d+\s*(?:bed|br)/i.test(t) || /studio/i.test(t));
      const sqftCell = cellTexts.find(t => /[\d,]+\s*(?:sq|sf)/i.test(t));

      if (priceCell && bedsCell) {
        const price = parseInt(priceCell.replace(/[^0-9]/g, ''));
        const bedrooms = /studio/i.test(bedsCell) ? 0 : parseInt(bedsCell.replace(/[^0-9]/g, '') || '0');
        const sqft = sqftCell ? parseInt(sqftCell.replace(/[^0-9]/g, '')) : 0;

        if (price > 0) {
          plans.push({
            name: cellTexts[0] || 'Unknown',
            bedrooms,
            bathrooms: 1,
            sqftMin: sqft,
            sqftMax: sqft,
            priceMin: price,
            priceMax: price,
            availableUnits: 0,
          });
        }
      }
    }
  }

  return plans;
}

export async function scrapeRentCafe(
  apartment: { id: number; websiteUrl: string }
): Promise<ScrapedFloorPlan[] | null> {
  try {
    const res = await fetch(apartment.websiteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      console.warn(`[rentcafe] Failed to fetch ${apartment.websiteUrl}: HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Try the API approach first
    const credentials = extractCredentials(html);
    if (credentials) {
      const plans = await fetchViaApi(credentials);
      if (plans && plans.length > 0) {
        console.log(`[rentcafe] API success for apartment ${apartment.id}: ${plans.length} floor plans`);
        return plans;
      }
      console.warn(`[rentcafe] API returned no plans for apartment ${apartment.id}, trying HTML fallback`);
    } else {
      console.warn(`[rentcafe] No API credentials found for apartment ${apartment.id}, trying HTML fallback`);
    }

    // Fallback: parse HTML directly
    const fallbackPlans = parseHtmlFallback(html);
    if (fallbackPlans.length > 0) {
      console.log(`[rentcafe] HTML fallback success for apartment ${apartment.id}: ${fallbackPlans.length} floor plans`);
      return fallbackPlans;
    }

    console.warn(`[rentcafe] No floor plans found for apartment ${apartment.id}`);
    return null;
  } catch (err) {
    console.warn(`[rentcafe] Error scraping apartment ${apartment.id}:`, (err as Error).message);
    return null;
  }
}
