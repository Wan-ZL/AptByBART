import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from './client';

async function migrate() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

  // Split by semicolons, filter empty statements
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`Running ${statements.length} migration statements...`);

  for (const statement of statements) {
    await db.execute(statement);
    // Log first 60 chars of each statement
    console.log(`  ✓ ${statement.substring(0, 60)}...`);
  }

  console.log('Migration complete!');
}

migrate().catch(console.error);
