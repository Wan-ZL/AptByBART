import * as cheerio from 'cheerio';
import { ScrapedFloorPlan } from './rentcafe';

export async function scrapeWithCheerio(
  apartment: { id: number; websiteUrl: string }
): Promise<ScrapedFloorPlan[] | null> {
  const res = await fetch(apartment.websiteUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;

  const html = await res.text();
  const $ = cheerio.load(html);
  const plans: ScrapedFloorPlan[] = [];

  // Strategy 1: JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (
          item['@type'] === 'ApartmentComplex' ||
          item['@type'] === 'Apartment'
        ) {
          if (item.floorSize || item.numberOfRooms) {
            plans.push({
              name: item.name ?? null,
              bedrooms: item.numberOfBedrooms ?? item.numberOfRooms ?? 0,
              bathrooms: item.numberOfBathroomsTotal ?? 1,
              sqftMin: item.floorSize?.value ? parseInt(item.floorSize.value) : null,
              sqftMax: null,
              priceMin: item.price ? parseInt(item.price) : null,
              priceMax: null,
              availableUnits: null,
            });
          }
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  });

  if (plans.length > 0) return plans;

  // Strategy 2: Common pricing element selectors
  const selectors = [
    '.floorplan', '.floor-plan', '[data-floorplan]',
    '.pricing-table', '.rent-grid', '.unit-list',
    '.pricingGridItem', '.fp-group', '.plan-card',
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = $(el).text();
      const plan = extractPlanFromText(text);
      if (plan) plans.push(plan);
    });
    if (plans.length > 0) return plans;
  }

  // Strategy 3: Table rows with bed/bath/sqft/price columns
  $('table').each((_, table) => {
    const headers = $(table)
      .find('th, thead td')
      .map((_, th) => $(th).text().trim().toLowerCase())
      .get();

    const hasPricingHeaders = headers.some(
      (h) =>
        h.includes('bed') ||
        h.includes('bath') ||
        h.includes('rent') ||
        h.includes('price') ||
        h.includes('sqft') ||
        h.includes('sq ft')
    );

    if (!hasPricingHeaders) return;

    $(table)
      .find('tbody tr, tr')
      .each((_, row) => {
        const cells = $(row)
          .find('td')
          .map((_, td) => $(td).text().trim())
          .get();
        if (cells.length < 2) return;

        const rowText = cells.join(' ');
        const plan = extractPlanFromText(rowText);
        if (plan) plans.push(plan);
      });
  });

  if (plans.length > 0) return plans;

  // Strategy 4: Scan full page for pricing patterns
  const priceBlocks = $('[class*="price"], [class*="rent"], [class*="pricing"], [class*="floorplan"], [class*="floor-plan"]');
  priceBlocks.each((_, el) => {
    const text = $(el).text();
    const plan = extractPlanFromText(text);
    if (plan) plans.push(plan);
  });

  return plans.length > 0 ? plans : null;
}

function extractPlanFromText(text: string): ScrapedFloorPlan | null {
  const priceMatch = text.match(/\$[\s]*([\d,]+)/);
  const bedMatch = text.match(/(\d)\s*(?:bed|br|bedroom)/i) ?? text.match(/studio/i);
  const bathMatch = text.match(/([\d.]+)\s*(?:bath|ba|bathroom)/i);
  const sqftMatch = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft|sf)/i);

  if (!priceMatch && !bedMatch) return null;

  const priceMin = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

  // Try to find a price range like "$1,500 - $1,800"
  const priceRangeMatch = text.match(
    /\$[\s]*([\d,]+)\s*[-–—]\s*\$?[\s]*([\d,]+)/
  );
  let priceMax: number | null = null;
  let priceMinResolved = priceMin;
  if (priceRangeMatch) {
    priceMinResolved = parseInt(priceRangeMatch[1].replace(/,/g, ''));
    priceMax = parseInt(priceRangeMatch[2].replace(/,/g, ''));
  }

  // Try to find sqft range like "650 - 850 sq ft"
  const sqftRangeMatch = text.match(
    /([\d,]+)\s*[-–—]\s*([\d,]+)\s*(?:sq\.?\s*ft|sqft|sf)/i
  );
  let sqftMin: number | null = sqftMatch
    ? parseInt(sqftMatch[1].replace(/,/g, ''))
    : null;
  let sqftMax: number | null = null;
  if (sqftRangeMatch) {
    sqftMin = parseInt(sqftRangeMatch[1].replace(/,/g, ''));
    sqftMax = parseInt(sqftRangeMatch[2].replace(/,/g, ''));
  }

  const isStudio = bedMatch?.[0]?.toLowerCase() === 'studio';
  const bedrooms = isStudio ? 0 : bedMatch ? parseInt(bedMatch[1]) : 0;
  const bathrooms = bathMatch ? parseFloat(bathMatch[1]) : 1;

  // Extract plan name — look for text before the bed/price info
  const nameMatch = text.match(/^[\s]*([A-Za-z][\w\s-]{1,30}?)(?=\s*\d|\s*\$|\s*studio|\s*bed)/i);

  return {
    name: nameMatch?.[1]?.trim() ?? null,
    bedrooms,
    bathrooms,
    sqftMin,
    sqftMax,
    priceMin: priceMinResolved,
    priceMax,
    availableUnits: null,
  };
}
