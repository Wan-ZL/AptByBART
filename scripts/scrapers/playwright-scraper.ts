import { chromium, type BrowserContext, type Page } from 'playwright';
import { ScrapedFloorPlan } from './rentcafe';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
];

export async function scrapeWithPlaywright(
  apartment: { id: number; websiteUrl: string }
): Promise<ScrapedFloorPlan[] | null> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
      permissions: ['geolocation'],
    });

    // Comprehensive stealth: patch navigator, chrome runtime, WebGL, permissions
    await context.addInitScript(() => {
      // Hide webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Chrome runtime
      (window as any).chrome = {
        runtime: { id: 'fake-extension-id', connect: () => {}, sendMessage: () => {} },
        loadTimes: () => ({ commitLoadTime: Date.now() / 1000 }),
        csi: () => ({ startE: Date.now(), onloadT: Date.now() }),
      };

      // Realistic plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ];
          return Object.assign(plugins, { length: plugins.length, item: (i: number) => plugins[i], namedItem: (n: string) => plugins.find(p => p.name === n) || null, refresh: () => {} });
        },
      });

      // Languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'language', { get: () => 'en-US' });

      // Platform
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

      // Hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

      // Device memory
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

      // Permissions
      const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
      if (originalQuery) {
        (navigator.permissions as any).query = (params: any) => {
          if (params.name === 'notifications') {
            return Promise.resolve({ state: 'denied', onchange: null } as any);
          }
          return originalQuery(params);
        };
      }

      // WebGL vendor/renderer (prevent bot detection via GPU fingerprint)
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(param: number) {
        if (param === 37445) return 'Intel Inc.';
        if (param === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, param);
      };
    });

    const page = await context.newPage();

    // Block images and media for performance (keep CSS/fonts to avoid bot detection)
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // Intercept XHR/fetch responses that might contain pricing JSON
    const interceptedData: any[] = [];
    page.on('response', async (response) => {
      const contentType = response.headers()['content-type'] ?? '';
      if (!contentType.includes('application/json')) return;

      try {
        const json = await response.json();
        const text = JSON.stringify(json).toLowerCase();
        if (
          text.includes('floorplan') ||
          text.includes('floor_plan') ||
          text.includes('pricing') ||
          text.includes('bedrooms') ||
          text.includes('rent')
        ) {
          interceptedData.push(json);
        }
      } catch {
        // Not valid JSON, skip
      }
    });

    // Navigate with domcontentloaded (faster than networkidle, less likely to timeout)
    await page.goto(apartment.websiteUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Detect Cloudflare challenge and wait for it to resolve
    const isCloudflare = await page.evaluate(() => {
      return document.title.includes('Just a moment') ||
             document.title.includes('Checking your browser') ||
             document.querySelector('#challenge-running') !== null ||
             document.querySelector('.cf-browser-verification') !== null;
    });

    if (isCloudflare) {
      console.log(`  [Playwright] Cloudflare challenge detected, waiting...`);
      try {
        await page.waitForFunction(() => {
          return !document.title.includes('Just a moment') &&
                 !document.title.includes('Checking your browser');
        }, { timeout: 15_000 });
        // Wait for page to fully load after challenge resolves
        await page.waitForTimeout(2000);
      } catch {
        console.log(`  [Playwright] Cloudflare challenge did not resolve`);
        return null;
      }
    }

    // Random delay 1-3 seconds to appear human
    await page.waitForTimeout(1000 + Math.random() * 2000);

    // Wait for dynamic content to render
    await page.waitForTimeout(2000);

    // Try extracting from intercepted API responses first
    const plans = parseInterceptedData(interceptedData);
    if (plans.length > 0) {
      return plans;
    }

    // Extract from rendered DOM
    const domPlans = await extractFromDOM(page);
    return domPlans.length > 0 ? domPlans : null;
  } catch {
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function parseInterceptedData(dataList: any[]): ScrapedFloorPlan[] {
  const plans: ScrapedFloorPlan[] = [];

  for (const data of dataList) {
    const items = findFloorPlanArrays(data);
    for (const item of items) {
      const plan = normalizeFloorPlan(item);
      if (plan) plans.push(plan);
    }
  }

  return plans;
}

function findFloorPlanArrays(obj: any, depth = 0): any[] {
  if (depth > 5 || !obj) return [];

  if (Array.isArray(obj)) {
    // Check if this looks like a floor plan array
    const sample = obj[0];
    if (sample && typeof sample === 'object') {
      const keys = Object.keys(sample).map((k) => k.toLowerCase());
      if (
        keys.some(
          (k) =>
            k.includes('bed') ||
            k.includes('bath') ||
            k.includes('rent') ||
            k.includes('price') ||
            k.includes('floorplan') ||
            k.includes('floor_plan')
        )
      ) {
        return obj;
      }
    }
    return obj.flatMap((item) => findFloorPlanArrays(item, depth + 1));
  }

  if (typeof obj === 'object') {
    return Object.values(obj).flatMap((val) =>
      findFloorPlanArrays(val, depth + 1)
    );
  }

  return [];
}

function normalizeFloorPlan(item: any): ScrapedFloorPlan | null {
  if (!item || typeof item !== 'object') return null;

  const keys = Object.keys(item);
  const get = (patterns: string[]): any => {
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (patterns.some((p) => lower.includes(p))) return item[key];
    }
    return null;
  };

  const bedrooms = get(['bedroom', 'beds', 'bed']);
  const price = get(['price', 'rent', 'rate']);

  if (bedrooms === null && price === null) return null;

  const parseNum = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'string' ? parseInt(v.replace(/[$,]/g, '')) : Number(v);
    return isNaN(n) ? null : n;
  };

  return {
    name: get(['name', 'title', 'plan_name', 'floorplanname']) ?? null,
    bedrooms: parseNum(bedrooms) ?? 0,
    bathrooms: parseNum(get(['bathroom', 'baths', 'bath'])) ?? 1,
    sqftMin: parseNum(get(['sqft_min', 'minsqft', 'min_sqft', 'sqft', 'squarefeet', 'square_feet', 'area'])),
    sqftMax: parseNum(get(['sqft_max', 'maxsqft', 'max_sqft'])),
    priceMin: parseNum(get(['price_min', 'minprice', 'min_rent', 'minrent', 'price', 'rent'])),
    priceMax: parseNum(get(['price_max', 'maxprice', 'max_rent', 'maxrent'])),
    availableUnits: parseNum(get(['available', 'avail', 'units_available', 'count'])),
  };
}

async function extractFromDOM(page: Page): Promise<ScrapedFloorPlan[]> {
  return page.evaluate(() => {
    const plans: any[] = [];

    // Check JSON-LD
    document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try {
        const data = JSON.parse(el.textContent ?? '');
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item['@type'] === 'ApartmentComplex' || item['@type'] === 'Apartment') {
            if (item.numberOfBedrooms !== undefined || item.price) {
              plans.push({
                name: item.name ?? null,
                bedrooms: item.numberOfBedrooms ?? 0,
                bathrooms: item.numberOfBathroomsTotal ?? 1,
                sqftMin: item.floorSize?.value ? parseInt(item.floorSize.value) : null,
                sqftMax: null,
                priceMin: item.price ? parseInt(String(item.price).replace(/[$,]/g, '')) : null,
                priceMax: null,
                availableUnits: null,
              });
            }
          }
        }
      } catch {
        // skip
      }
    });

    if (plans.length > 0) return plans;

    // Scan rendered elements for pricing patterns
    const selectors = [
      '.floorplan', '.floor-plan', '[data-floorplan]',
      '.pricing-table', '.rent-grid', '.unit-list',
      '.pricingGridItem', '.fp-group', '.plan-card',
      '[class*="floorplan"]', '[class*="floor-plan"]',
      '[class*="pricing"]', '[class*="rent"]',
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        const text = el.textContent ?? '';
        const priceMatch = text.match(/\$[\s]*([\d,]+)/);
        const bedMatch = text.match(/(\d)\s*(?:bed|br|bedroom)/i) ?? text.match(/studio/i);

        if (!priceMatch && !bedMatch) return;

        const priceRangeMatch = text.match(/\$[\s]*([\d,]+)\s*[-–—]\s*\$?[\s]*([\d,]+)/);
        const sqftMatch = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft|sf)/i);
        const bathMatch = text.match(/([\d.]+)\s*(?:bath|ba)/i);
        const isStudio = bedMatch?.[0]?.toLowerCase() === 'studio';

        plans.push({
          name: null,
          bedrooms: isStudio ? 0 : bedMatch ? parseInt(bedMatch[1]) : 0,
          bathrooms: bathMatch ? parseFloat(bathMatch[1]) : 1,
          sqftMin: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
          sqftMax: null,
          priceMin: priceRangeMatch
            ? parseInt(priceRangeMatch[1].replace(/,/g, ''))
            : priceMatch
              ? parseInt(priceMatch[1].replace(/,/g, ''))
              : null,
          priceMax: priceRangeMatch ? parseInt(priceRangeMatch[2].replace(/,/g, '')) : null,
          availableUnits: null,
        });
      });
      if (plans.length > 0) return plans;
    }

    return plans;
  });
}
