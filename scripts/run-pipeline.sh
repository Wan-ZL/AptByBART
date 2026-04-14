#!/bin/bash
set -e

echo "========================================"
echo "  AptByBART Scrape Pipeline"
echo "========================================"

# Create output directory
mkdir -p tier_results

# Step 1: T1 RentCafe
echo ""
echo "=== Step 1/8: T1 RentCafe ==="
npx tsx scripts/scrape.ts --tier t1

# Step 2: T2 Cheerio
echo ""
echo "=== Step 2/8: T2 Cheerio ==="
npx tsx scripts/scrape.ts --tier t2

# Step 3: T3 Crawl4AI
echo ""
echo "=== Step 3/8: T3 Crawl4AI ==="
npx tsx scripts/scrape.ts --tier t3

# Step 4+5: Merge results + identify T4 pool
echo ""
echo "=== Step 4/8: Merge T1+T2+T3 ==="
npx tsx scripts/merge-results.ts

# Step 5: GPT Review
echo ""
echo "=== Step 5/8: GPT-5.4 Review ==="
npx tsx scripts/gpt-review.ts

# Step 6: T4 AI+Playwright on pool
echo ""
echo "=== Step 6/8: T4 AI+Playwright ==="
node --expose-gc node_modules/.bin/tsx scripts/scrape.ts --tier t4

# Step 7: Final merge to DB
echo ""
echo "=== Step 7/8: Final Merge to DB ==="
npx tsx scripts/final-merge.ts

# Step 8: Summary
echo ""
echo "=== Step 8/8: Final Summary ==="
sqlite3 local.db "SELECT 'Apartments with prices: ' || count(*) FROM apartments WHERE id IN (SELECT DISTINCT apartment_id FROM floor_plans);"
sqlite3 local.db "SELECT 'Total floor plans: ' || count(*) FROM floor_plans;"
sqlite3 local.db "SELECT 'Apartments with amenities: ' || count(*) FROM apartments WHERE has_in_unit_wd=1 OR has_dishwasher=1 OR has_parking=1 OR has_gym=1 OR has_pool=1 OR pet_friendly=1;"
sqlite3 local.db "SELECT 'Coverage: ' || printf('%.1f%%', count(CASE WHEN id IN (SELECT DISTINCT apartment_id FROM floor_plans) THEN 1 END) * 100.0 / count(*)) FROM apartments;"

echo ""
echo "Pipeline complete!"
