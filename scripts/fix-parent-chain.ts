import { readFileSync } from 'fs';
import { resolve } from 'path';
import { db } from '../db/client';

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

// 2020 Census
const STATE_POPULATION = 39538223;

const COUNTIES: Array<{ slug: string; name: string; population: number }> = [
  { slug: 'alameda', name: 'Alameda', population: 1682353 },
  { slug: 'contra_costa', name: 'Contra Costa', population: 1165927 },
  { slug: 'marin', name: 'Marin', population: 260266 },
  { slug: 'napa', name: 'Napa', population: 138019 },
  { slug: 'san_francisco', name: 'San Francisco', population: 873965 },
  { slug: 'san_mateo', name: 'San Mateo', population: 764442 },
  { slug: 'santa_clara', name: 'Santa Clara', population: 1936259 },
  { slug: 'solano', name: 'Solano', population: 453491 },
  { slug: 'sonoma', name: 'Sonoma', population: 488863 },
];

// City slug → county slug. Supports both underscore and dash slugs.
const CITY_TO_COUNTY: Record<string, string> = {};
const countyCityMap: Record<string, string[]> = {
  alameda: [
    'oakland', 'berkeley', 'fremont', 'hayward', 'pleasanton', 'livermore',
    'dublin', 'san_leandro', 'alameda', 'union_city', 'newark', 'albany',
    'emeryville', 'piedmont', 'castro_valley', 'san_lorenzo', 'ashland',
    'cherryland', 'sunol', 'fairview',
  ],
  contra_costa: [
    'richmond', 'concord', 'walnut_creek', 'antioch', 'pittsburg',
    'pleasant_hill', 'martinez', 'san_ramon', 'danville', 'lafayette',
    'orinda', 'moraga', 'hercules', 'pinole', 'el_cerrito', 'san_pablo',
    'brentwood', 'oakley',
  ],
  marin: [
    'san_rafael', 'novato', 'sausalito', 'mill_valley', 'tiburon',
    'larkspur', 'corte_madera',
  ],
  napa: [
    'napa', 'american_canyon', 'calistoga', 'st_helena', 'yountville',
  ],
  san_francisco: ['san_francisco'],
  san_mateo: [
    'san_mateo', 'daly_city', 'redwood_city', 'south_san_francisco',
    'san_bruno', 'burlingame', 'millbrae', 'belmont', 'foster_city',
    'san_carlos', 'hillsborough', 'menlo_park', 'atherton',
    'east_palo_alto', 'half_moon_bay', 'portola_valley', 'woodside',
    'brisbane', 'colma', 'pacifica',
  ],
  santa_clara: [
    'san_jose', 'sunnyvale', 'santa_clara', 'mountain_view', 'palo_alto',
    'milpitas', 'cupertino', 'saratoga', 'campbell', 'los_gatos', 'gilroy',
    'morgan_hill', 'los_altos', 'los_altos_hills', 'monte_sereno',
  ],
  solano: [
    'vallejo', 'fairfield', 'vacaville', 'benicia', 'suisun_city', 'dixon',
    'rio_vista',
  ],
  sonoma: [
    'santa_rosa', 'petaluma', 'rohnert_park', 'healdsburg', 'sonoma',
    'windsor', 'sebastopol', 'cotati',
  ],
};

for (const [countySlug, cities] of Object.entries(countyCityMap)) {
  for (const citySlug of cities) {
    CITY_TO_COUNTY[citySlug] = countySlug;
    // Also register dash variant for auto-created rows
    CITY_TO_COUNTY[citySlug.replace(/_/g, '-')] = countySlug;
  }
}

async function main() {
  console.log('Fixing geo_areas parent chain...\n');

  // 1. Insert state:california
  await db.execute({
    sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population)
          VALUES (?, ?, 'state', NULL, NULL, NULL, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            area_type = excluded.area_type,
            parent_area_id = NULL,
            population = excluded.population`,
    args: ['state:california', 'California', STATE_POPULATION],
  });
  console.log(`Inserted/updated state:california (pop ${STATE_POPULATION})`);

  // 2. Insert/upsert all 9 counties with parent=state:california
  let countyInserted = 0;
  for (const county of COUNTIES) {
    const id = `county:${county.slug}`;
    await db.execute({
      sql: `INSERT INTO geo_areas (id, name, area_type, parent_area_id, centroid_lat, centroid_lng, population)
            VALUES (?, ?, 'county', 'state:california', NULL, NULL, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              parent_area_id = 'state:california',
              population = excluded.population`,
      args: [id, county.name, county.population],
    });
    countyInserted++;
  }
  console.log(`Upserted ${countyInserted} counties, all parent=state:california`);

  // 3. Ensure ALL counties (even unlisted) are chained to state
  const countyFix = await db.execute({
    sql: `UPDATE geo_areas SET parent_area_id = 'state:california'
          WHERE area_type = 'county' AND parent_area_id IS NULL AND id != 'state:california'`,
    args: [],
  });
  console.log(`UPDATE counties without parent → state:california: ${countyFix.rowsAffected} rows`);

  // 4. UPDATE existing city rows with their county parent
  let cityUpdated = 0;
  let cityUnmapped = 0;
  const citiesResult = await db.execute("SELECT id FROM geo_areas WHERE area_type = 'city'");
  for (const row of citiesResult.rows) {
    const cityId = row.id as string;
    const slug = cityId.replace(/^city:/, '');
    const countySlug = CITY_TO_COUNTY[slug] ?? CITY_TO_COUNTY[slug.replace(/-/g, '_')];
    if (!countySlug) {
      cityUnmapped++;
      console.log(`  [unmapped] ${cityId}`);
      continue;
    }
    await db.execute({
      sql: `UPDATE geo_areas SET parent_area_id = ? WHERE id = ?`,
      args: [`county:${countySlug}`, cityId],
    });
    cityUpdated++;
  }
  console.log(`\nUpdated ${cityUpdated} cities with county parent`);
  console.log(`Unmapped cities (still NULL parent): ${cityUnmapped}`);

  // 5. Verify
  console.log('\n--- Verification ---');
  const verify = await db.execute(`
    SELECT area_type, COUNT(*) as total,
           SUM(CASE WHEN parent_area_id IS NULL THEN 1 ELSE 0 END) as null_parent
    FROM geo_areas
    GROUP BY area_type
    ORDER BY area_type
  `);
  for (const row of verify.rows) {
    console.log(`  ${row.area_type}: total=${row.total}, null_parent=${row.null_parent}`);
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
