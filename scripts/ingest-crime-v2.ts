/**
 * Crime Data Ingestion v2 — entry point
 * Runs all modular ingesters via the orchestrator.
 *
 * Usage: npm run ingest:crime:v2
 */

import { readFileSync } from 'fs';
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

import { runIngestion } from './ingest/orchestrator';
import { caDojIngester } from './ingest/ca-doj';
import { datasfIngester } from './ingest/datasf';
import { oaklandIngester } from './ingest/oakland';
import { fbiIngester } from './ingest/fbi';
import { sjpdIngester } from './ingest/sjpd';
import { berkeleyIngester } from './ingest/berkeley';
import { alamedaSheriffIngester } from './ingest/alameda-sheriff';
import { sunnyvaleIngester } from './ingest/sunnyvale';
import { paloAltoIngester } from './ingest/palo-alto';
import { richmondIngester } from './ingest/richmond';
import { mountainViewIngester } from './ingest/mountain-view';
import { fremontIngester } from './ingest/fremont';
import { haywardIngester } from './ingest/hayward';
import { walnutCreekIngester } from './ingest/walnut-creek';
import { concordIngester } from './ingest/concord';

async function main() {
  console.log('=== Crime Data Ingestion v2 ===\n');

  // Build ingester list — santa-clara and marin are loaded dynamically
  // to avoid hard failure if they don't exist yet
  const ingesters = [
    caDojIngester,
    datasfIngester,
    oaklandIngester,
    sjpdIngester,
    berkeleyIngester,
    alamedaSheriffIngester,
    sunnyvaleIngester,
    paloAltoIngester,
    richmondIngester,
    mountainViewIngester,
    fremontIngester,
    haywardIngester,
    walnutCreekIngester,
    concordIngester,
  ];

  try {
    const { santaClaraIngester } = await import('./ingest/santa-clara');
    ingesters.push(santaClaraIngester);
  } catch {
    console.log('Note: santa-clara ingester not available, skipping');
  }

  try {
    const { marinIngester } = await import('./ingest/marin');
    ingesters.push(marinIngester);
  } catch {
    console.log('Note: marin ingester not available, skipping');
  }

  ingesters.push(fbiIngester);

  await runIngestion(ingesters);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
