/**
 * Reusable client for the Socrata SODA API.
 * Used by DataSF, Oakland, and other Socrata-backed open-data portals.
 */

interface SocrataParams {
  domain: string;
  datasetId: string;
  select?: string;
  where?: string;
  group?: string;
  order?: string;
  limit?: number;
  offset?: number;
  appToken?: string;
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

export async function fetchSocrata(
  params: SocrataParams
): Promise<Record<string, string | number>[]> {
  const {
    domain,
    datasetId,
    select,
    where,
    group,
    order,
    limit = 50000,
    offset = 0,
    appToken,
  } = params;

  const url = new URL(`https://${domain}/resource/${datasetId}.json`);
  if (select) url.searchParams.set('$select', select);
  if (where) url.searchParams.set('$where', where);
  if (group) url.searchParams.set('$group', group);
  if (order) url.searchParams.set('$order', order);
  url.searchParams.set('$limit', String(limit));
  url.searchParams.set('$offset', String(offset));

  const token = appToken ?? process.env.SOCRATA_APP_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['X-App-Token'] = token;

  // Log URL without token for debugging
  console.log(`  Socrata GET ${url.toString()}`);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.log(`  Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as Record<string, string | number>[];
    } catch (err) {
      lastError = err as Error;
      console.warn(`  Socrata request failed (attempt ${attempt + 1}): ${lastError.message}`);
    }
  }

  throw new Error(`Socrata fetch failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`);
}
