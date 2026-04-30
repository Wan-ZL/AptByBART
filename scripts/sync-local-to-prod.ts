// Selective sync: push local → prod for safety-system tables only.
// Prod-canonical tables (floor_plans, price_history, scrape_logs, bart_stations,
// crime_stats) are left untouched. apartments rows are preserved; only the new
// geo_area_id column is updated from local.

import { createClient } from '@libsql/client';

const prodUrl = process.env.TURSO_DATABASE_URL;
const prodToken = process.env.TURSO_AUTH_TOKEN;
const execute = process.argv.includes('--execute');

if (!prodUrl || !prodToken) {
  console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
  process.exit(1);
}
if (!prodUrl.startsWith('libsql://')) {
  console.error('TURSO_DATABASE_URL must point to remote (libsql://...)');
  process.exit(1);
}

const local = createClient({ url: 'file:local.db' });
const prod = createClient({ url: prodUrl, authToken: prodToken });

const REPLACE_TABLES_DELETE_ORDER = [
  'station_geo_areas',
  'apartment_geo_areas',
  'safety_scores',
  'crime_observations',
  'geo_areas',
  'crime_data_sources',
] as const;

const REPLACE_TABLES_INSERT_ORDER = [
  'crime_data_sources',
  'geo_areas',
  'crime_observations',
  'safety_scores',
  'apartment_geo_areas',
  'station_geo_areas',
] as const;

const BATCH_SIZE = 400;

function quoteId(name: string) {
  return '"' + name.replace(/"/g, '""') + '"';
}

async function getColumns(client: ReturnType<typeof createClient>, table: string): Promise<string[]> {
  const r = await client.execute(`PRAGMA table_info(${quoteId(table)})`);
  return r.rows.map(row => row.name as string);
}

async function tableExists(client: ReturnType<typeof createClient>, table: string): Promise<boolean> {
  const r = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    args: [table],
  });
  return r.rows.length > 0;
}

async function fetchAll(client: ReturnType<typeof createClient>, table: string) {
  const r = await client.execute(`SELECT * FROM ${quoteId(table)}`);
  return r;
}

// Tables with a self-referencing FK column that must be NULL on initial insert,
// then back-filled with a second UPDATE pass.
const SELF_REF_FK: Record<string, string> = {
  geo_areas: 'parent_area_id',
};

async function replaceTable(table: string) {
  if (!(await tableExists(local, table))) {
    console.log(`  ↩ skip ${table}: not in local`);
    return;
  }
  if (!(await tableExists(prod, table))) {
    console.log(`  ↩ skip ${table}: not in prod`);
    return;
  }
  const localCols = await getColumns(local, table);
  const prodCols = await getColumns(prod, table);
  const cols = localCols.filter(c => prodCols.includes(c));
  if (cols.length === 0) {
    console.log(`  ↩ skip ${table}: no shared columns`);
    return;
  }
  const data = await fetchAll(local, table);
  console.log(
    `  → ${table}: ${data.rows.length} local rows, cols=[${cols.join(',')}]`
  );

  if (!execute) return;

  const selfRefCol = SELF_REF_FK[table];
  const insertCols = selfRefCol ? cols.filter(c => c !== selfRefCol) : cols;
  const colList = insertCols.map(quoteId).join(', ');
  const placeholders = insertCols.map(() => '?').join(', ');
  const insertSql = `INSERT INTO ${quoteId(table)} (${colList}) VALUES (${placeholders})`;

  for (let i = 0; i < data.rows.length; i += BATCH_SIZE) {
    const slice = data.rows.slice(i, i + BATCH_SIZE);
    await prod.batch(
      slice.map(row => ({
        sql: insertSql,
        args: insertCols.map(c => {
          const v = row[c as keyof typeof row] as unknown;
          return (v === undefined ? null : v) as
            | null
            | string
            | number
            | bigint
            | ArrayBuffer
            | Uint8Array;
        }),
      })),
      'write'
    );
    process.stdout.write(`    inserted ${Math.min(i + BATCH_SIZE, data.rows.length)}/${data.rows.length}\r`);
  }
  process.stdout.write('\n');

  if (selfRefCol) {
    // Back-fill self-referencing FK column now that all rows exist.
    const idCol = cols.includes('id') ? 'id' : cols[0];
    const updateSql = `UPDATE ${quoteId(table)} SET ${quoteId(selfRefCol)} = ? WHERE ${quoteId(idCol)} = ?`;
    const refRows = data.rows.filter(r => r[selfRefCol as keyof typeof r] != null);
    let updated = 0;
    for (let i = 0; i < refRows.length; i += BATCH_SIZE) {
      const slice = refRows.slice(i, i + BATCH_SIZE);
      await prod.batch(
        slice.map(row => ({
          sql: updateSql,
          args: [
            row[selfRefCol as keyof typeof row] as string,
            row[idCol as keyof typeof row] as string,
          ],
        })),
        'write'
      );
      updated += slice.length;
      process.stdout.write(`    backfilled ${selfRefCol} ${updated}/${refRows.length}\r`);
    }
    process.stdout.write('\n');
  }
}

async function deletePhase() {
  console.log(`\n[Phase B-PRE] NULL apartments.geo_area_id to release FK to geo_areas`);
  if (execute) {
    await prod.execute('UPDATE apartments SET geo_area_id = NULL WHERE geo_area_id IS NOT NULL');
    console.log('  · apartments.geo_area_id cleared');
  } else {
    const r = await prod.execute('SELECT COUNT(*) as c FROM apartments WHERE geo_area_id IS NOT NULL');
    console.log(`  · would clear ${r.rows[0].c} apartments.geo_area_id values`);
  }

  console.log(`\n[Phase B-DELETE] Wiping target tables on prod (FK reverse order)`);
  for (const t of REPLACE_TABLES_DELETE_ORDER) {
    if (!(await tableExists(prod, t))) {
      console.log(`  ↩ skip ${t}: not on prod`);
      continue;
    }
    const before = await prod.execute(`SELECT COUNT(*) as c FROM ${quoteId(t)}`);
    const cnt = Number(before.rows[0].c);
    console.log(`  · ${t}: ${cnt} rows currently on prod`);
    if (execute && cnt > 0) {
      await prod.execute(`DELETE FROM ${quoteId(t)}`);
      console.log(`    deleted`);
    }
  }
}

async function insertPhase() {
  console.log(`\n[Phase B-INSERT] Pushing local rows to prod (FK forward order)`);
  for (const t of REPLACE_TABLES_INSERT_ORDER) {
    await replaceTable(t);
  }
}

async function updateApartmentsGeoArea() {
  console.log(`\n[Phase C] UPDATE apartments.geo_area_id from local`);
  const r = await local.execute(
    'SELECT id, geo_area_id FROM apartments WHERE geo_area_id IS NOT NULL'
  );
  console.log(`  · ${r.rows.length} local apartments have geo_area_id`);
  if (!execute) return;

  const updateSql = 'UPDATE apartments SET geo_area_id = ? WHERE id = ?';
  let updated = 0;
  for (let i = 0; i < r.rows.length; i += BATCH_SIZE) {
    const slice = r.rows.slice(i, i + BATCH_SIZE);
    await prod.batch(
      slice.map(row => ({
        sql: updateSql,
        args: [row.geo_area_id as string, row.id as number],
      })),
      'write'
    );
    updated += slice.length;
    process.stdout.write(`    updated ${updated}/${r.rows.length}\r`);
  }
  process.stdout.write('\n');
}

async function verify() {
  console.log(`\n[Verify] Final prod row counts`);
  const checkTables = [
    ...REPLACE_TABLES_INSERT_ORDER,
    'apartments',
    'floor_plans',
    'price_history',
    'scrape_logs',
    'bart_stations',
  ];
  for (const t of checkTables) {
    if (!(await tableExists(prod, t))) continue;
    const r = await prod.execute(`SELECT COUNT(*) as c FROM ${quoteId(t)}`);
    console.log(`  ${t}: ${r.rows[0].c}`);
  }
  const apt = await prod.execute(
    'SELECT COUNT(*) as c FROM apartments WHERE geo_area_id IS NOT NULL'
  );
  console.log(`  apartments.geo_area_id populated: ${apt.rows[0].c}`);
}

async function main() {
  console.log(`Mode: ${execute ? 'EXECUTE (writes to prod)' : 'DRY RUN'}`);
  console.log(`Prod: ${prodUrl}`);
  await deletePhase();
  await insertPhase();
  await updateApartmentsGeoArea();
  await verify();
  console.log(`\nDone. ${execute ? 'Changes committed to prod.' : 'Re-run with --execute to apply.'}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
