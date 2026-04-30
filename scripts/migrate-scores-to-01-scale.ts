/**
 * One-time migration: convert non-tract safety_scores.score from legacy 1-10 scale
 * (10 = safest, 1 = most dangerous) to new 0-1 ensemble scale (0 = safest, 1 = most dangerous).
 *
 * Formula: new = (10 - old) / 9
 *   old=10  -> new=0     (safest)
 *   old=1   -> new=1     (most dangerous)
 *   old=5.5 -> new=0.5
 *
 * Tracts are already on the 0-1 scale via computeTractEnsembleScores and are not touched.
 *
 * Idempotent: only transforms rows whose current score looks like the legacy 1-10
 * range. If all non-tract rows are already in [0, 1], the migration is a no-op.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/client';

const PROJECT_ROOT = join(__dirname, '..');

try {
  const envText = readFileSync(join(PROJECT_ROOT, '.env.local'), 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {
  // No .env.local — fine for local dev.
}

interface DistributionRow {
  area_type: string;
  cnt: number;
  min: number;
  max: number;
  avg: number;
}

async function distribution(): Promise<DistributionRow[]> {
  const res = await db.execute(
    `SELECT ga.area_type, COUNT(*) as cnt, MIN(ss.score) as min, MAX(ss.score) as max, AVG(ss.score) as avg
     FROM safety_scores ss
     JOIN geo_areas ga ON ss.geo_area_id = ga.id
     GROUP BY ga.area_type
     ORDER BY ga.area_type`
  );
  return res.rows.map(r => ({
    area_type: r.area_type as string,
    cnt: Number(r.cnt),
    min: Number(r.min),
    max: Number(r.max),
    avg: Number(r.avg),
  }));
}

function printDistribution(label: string, rows: DistributionRow[]): void {
  console.log(`\n=== ${label} ===`);
  console.log('area_type       cnt     min       max       avg');
  for (const r of rows) {
    console.log(
      `${r.area_type.padEnd(15)} ${String(r.cnt).padStart(4)}    ${r.min.toFixed(3).padStart(7)}   ${r.max.toFixed(3).padStart(7)}   ${r.avg.toFixed(3).padStart(7)}`
    );
  }
}

async function main() {
  console.log('migrate-scores-to-01-scale: converting non-tract safety_scores from 1-10 to 0-1');

  const before = await distribution();
  printDistribution('BEFORE', before);

  // Idempotency guard: identify non-tract rows with legacy-scale scores (score > 1).
  // Anything already in [0, 1] is left alone (already migrated, or re-ingested
  // under the new code path).
  const legacyCountRes = await db.execute(
    `SELECT COUNT(*) as cnt FROM safety_scores ss
     JOIN geo_areas ga ON ss.geo_area_id = ga.id
     WHERE ga.area_type != 'tract' AND ss.score > 1.0`
  );
  const legacyCount = Number(legacyCountRes.rows[0]?.cnt ?? 0);

  if (legacyCount === 0) {
    console.log('\nno non-tract rows with score > 1.0 — nothing to migrate (idempotent no-op)');
    process.exit(0);
  }

  console.log(`\nfound ${legacyCount} non-tract rows in legacy 1-10 range — transforming`);

  // Apply formula: new = round((10 - old) / 9, 3)
  // Scope: non-tract rows with score in legacy range (> 1.0). Any non-tract row
  // already at <= 1.0 is assumed migrated and skipped.
  const updateRes = await db.execute(
    `UPDATE safety_scores
     SET score = ROUND((10.0 - score) / 9.0, 3)
     WHERE geo_area_id IN (
       SELECT id FROM geo_areas WHERE area_type != 'tract'
     )
     AND score > 1.0`
  );

  console.log(`updated ${updateRes.rowsAffected} rows`);

  const after = await distribution();
  printDistribution('AFTER', after);

  // Verify: all area_types should now have min >= 0 AND max <= 1.
  const outOfRange = after.filter(r => r.min < 0 || r.max > 1);
  if (outOfRange.length > 0) {
    console.error('\nERROR: some area_types still have scores outside [0, 1]:');
    for (const r of outOfRange) console.error(`  ${r.area_type}: min=${r.min}, max=${r.max}`);
    process.exit(1);
  }

  console.log('\nOK: all safety_scores now in [0, 1] with 0 = safest, 1 = most dangerous');
  process.exit(0);
}

main().catch(err => {
  console.error('migration failed:', err);
  process.exit(1);
});
