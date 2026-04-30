import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { db } from './client';

async function applySql(label: string, sql: string) {
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    try {
      await db.execute(statement);
      console.log(`  ✓ ${statement.substring(0, 60)}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; swallow the
      // duplicate-column error so migrations remain idempotent across re-runs.
      if (msg.includes('duplicate column name')) {
        console.log(`  · skip (already applied): ${statement.substring(0, 60)}...`);
        continue;
      }
      console.error(`  ✗ ${label}: ${statement.substring(0, 80)}`);
      throw err;
    }
  }
}

async function migrate() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  console.log('Applying schema.sql...');
  await applySql('schema.sql', schema);

  const migrationsDir = join(__dirname, 'migrations');
  if (existsSync(migrationsDir)) {
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      console.log(`\nApplying ${file}...`);
      const content = readFileSync(join(migrationsDir, file), 'utf-8');
      await applySql(file, content);
    }
  }

  console.log('\nMigration complete!');
}

migrate().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
