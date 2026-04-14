#!/bin/bash
# Auto-restart scraper until all apartments are processed
MAX_ROUNDS=20
for i in $(seq 1 $MAX_ROUNDS); do
  PENDING=$(sqlite3 local.db "SELECT count(*) FROM apartments WHERE scrape_status = 'pending';")
  echo "=== Round $i/$MAX_ROUNDS — $PENDING pending ==="
  
  if [ "$PENDING" -eq 0 ]; then
    echo "All apartments processed!"
    break
  fi
  
  # Reset broken for retry (except those broken 3+ times across all rounds)
  sqlite3 local.db "UPDATE apartments SET scrape_status = 'pending' WHERE scrape_status = 'broken';"
  
  # Kill stale chrome processes
  pkill -f "chrome-headless-shell" 2>/dev/null
  sleep 2
  
  # Run scraper (pending-only to skip already-active apartments)
  npx tsx scripts/scrape.ts --pending-only 2>&1 | tee -a scrape-loop-round-$i.log
  
  # Brief pause between rounds
  sleep 3
done

echo "=== FINAL STATUS ==="
sqlite3 local.db "SELECT scrape_status, count(*) FROM apartments GROUP BY scrape_status;"
sqlite3 local.db "SELECT count(*) as with_prices FROM apartments WHERE id IN (SELECT DISTINCT apartment_id FROM floor_plans);"
sqlite3 local.db "SELECT count(*) as floor_plans FROM floor_plans;"
