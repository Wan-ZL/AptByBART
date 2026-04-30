import { createClient } from '@libsql/client';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

const url = requireEnv('TURSO_DATABASE_URL');
const authToken = requireEnv('TURSO_AUTH_TOKEN');
const outDir = requireEnv('BACKUP_DIR');

mkdirSync(outDir, { recursive: true });
const prod = createClient({ url, authToken });

async function main() {
  const tables = await prod.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const summary: Record<string, number> = {};

  for (const row of tables.rows) {
    const name = row.name as string;
    const data = await prod.execute(`SELECT * FROM ${name}`);
    summary[name] = data.rows.length;
    const path = join(outDir, `${name}.json`);
    writeFileSync(
      path,
      JSON.stringify(
        { columns: data.columns, rows: data.rows.map(r => ({ ...r })) },
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
        2
      )
    );
    console.log(`  ✓ ${name}: ${data.rows.length} rows -> ${path}`);
  }

  writeFileSync(join(outDir, '_summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nBackup complete:', outDir);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
