---
name: test-lighthouse
description: Lighthouse performance/SEO/a11y/best-practices optimization with AI self-loop to push all scores to 90+
user-invocable: true
---

# Lighthouse Performance Optimization

You are an expert web performance engineer. Your job is to run Lighthouse audits on this Next.js application, identify the lowest-scoring areas, make targeted code fixes, and re-run until **all 4 Lighthouse categories score >= 90** on every tested page.

## STEP 1: PRODUCTION BUILD

Lighthouse MUST run against a production build. Dev server has no minification or code splitting — scores will be artificially low.

```bash
# Build for production
npm run build

# If build fails, report the error and stop
# If build succeeds, start production server in background
npm run start &
SERVER_PID=$!

# Wait for server to be ready
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
# If not 200, wait a few more seconds and retry
```

Remember the `$SERVER_PID` — you must kill it when done.

## STEP 2: RUN LIGHTHOUSE

### Determine pages to audit

- **Default pages**: `/` (homepage) and `/dashboard`
- If the user specified routes as arguments, use those instead
- If `git diff` shows changes to specific route files under `app/`, include those routes too

### Run Lighthouse (3 runs per page, take median)

```bash
# Create output directory
mkdir -p .lighthouse

# Check if lighthouse is available
npx lighthouse --version || npm install -g lighthouse

# Find Chrome path (Playwright installs Chromium)
CHROME_PATH=$(npx playwright install --dry-run chromium 2>/dev/null | grep -o '/.*chromium.*' || echo "")
# Fallback: check common paths
if [ -z "$CHROME_PATH" ]; then
  CHROME_PATH=$(find ~/Library/Caches/ms-playwright -name "chrome" -o -name "chromium" 2>/dev/null | head -1)
fi
# If still not found, let Lighthouse use system Chrome

# For each page, run 3 times
for PAGE in "/" "/dashboard"; do
  PAGE_NAME=$(echo "$PAGE" | tr '/' '_' | sed 's/^_//')
  [ -z "$PAGE_NAME" ] && PAGE_NAME="homepage"

  for RUN in 1 2 3; do
    npx lighthouse "http://localhost:3000${PAGE}" \
      --output=json \
      --output-path=".lighthouse/${PAGE_NAME}_run${RUN}.json" \
      --chrome-flags="--headless=new --no-sandbox" \
      --only-categories=performance,accessibility,best-practices,seo \
      --quiet
  done
done
```

### Extract scores

For each page, read the 3 JSON reports and compute the **median** score for each of the 4 categories:

- **Performance** (0-100)
- **Accessibility** (0-100)
- **Best Practices** (0-100)
- **SEO** (0-100)

Also extract the top audit **opportunities** with their estimated savings (e.g., "Properly size images — potential savings of 250 KiB").

## STEP 3: ANALYZE SCORES

Create a score matrix for all pages:

| Page | Performance | Accessibility | Best Practices | SEO |
| ---- | ----------- | ------------- | -------------- | --- |

Categorize each score:

- **>= 90**: No action needed
- **85-89**: Close — likely 1 targeted fix
- **< 85**: Significant work needed — multiple fixes required

For each category below 90, identify the top opportunities sorted by impact:

**Performance opportunities to look for:**

- Largest Contentful Paint (LCP) — images, fonts, server response time
- Cumulative Layout Shift (CLS) — missing image dimensions, dynamic content
- Interaction to Next Paint (INP) / Total Blocking Time (TBT) — heavy JS, long tasks
- Unused JavaScript — large bundles, dependencies loaded but not used
- Unoptimized images — wrong format, oversized, not lazy-loaded

**Accessibility opportunities to look for:**

- Color contrast ratios below WCAG AA
- Missing alt text on images
- Missing ARIA labels on interactive elements
- Keyboard navigation issues
- Form inputs without associated labels
- Missing landmark regions

**Best Practices opportunities to look for:**

- Console errors in production
- Deprecated APIs
- Images with incorrect aspect ratios
- HTTPS mixed content
- Missing CSP headers

**SEO opportunities to look for:**

- Missing or poor meta descriptions
- Missing Open Graph / Twitter card tags
- Missing canonical URLs
- Heading hierarchy issues (skipped levels)
- Missing robots.txt or sitemap.xml
- Non-descriptive link text

## STEP 4: FIX TOP OPPORTUNITIES

### Strategy

1. Pick the **LOWEST scoring category** first
2. Within that category, fix the **top 2-3 highest-impact** items
3. Prefer Next.js built-in optimizations over manual solutions

### Common Next.js Fixes

**Performance:**

- Replace `<img>` tags with `next/image` (automatic optimization, WebP, lazy loading)
- Add explicit `width` and `height` to all images (prevents CLS)
- Use `dynamic(() => import(...), { ssr: false })` for heavy below-fold components
- Set up `next/font` for Google Fonts (eliminates render-blocking font requests)
- Add `font-display: swap` to any custom @font-face declarations
- Preconnect to external domains in root layout:
  ```tsx
  <link rel="preconnect" href="https://rtypufgrcyggevlmwxsj.supabase.co" />
  ```
- Lazy load below-fold content with `loading="lazy"` or dynamic imports
- Review and reduce bundle size — check for heavy unused dependencies

**Accessibility:**

- Add `alt` text to every `<img>` and `next/image`
- Ensure color contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large text)
- Add ARIA labels to icon buttons and interactive elements without visible text
- Ensure proper heading hierarchy (`h1` → `h2` → `h3`, no skips)
- Add `role` attributes to landmark regions if semantic HTML isn't used
- Associate all form inputs with labels (`<label htmlFor="...">`)

**Best Practices:**

- Fix any console errors that appear in production
- Remove usage of deprecated browser APIs
- Ensure all images have correct aspect ratios (match intrinsic size)
- Fix any mixed content issues (HTTP resources on HTTPS page)

**SEO:**

- Use Next.js Metadata API (preferred over manual `<meta>` tags):
  ```tsx
  // In page.tsx or layout.tsx
  export const metadata: Metadata = {
    title: 'Page Title | Elenvo',
    description: 'Clear, compelling description under 160 chars',
    openGraph: {
      title: 'Page Title | Elenvo',
      description: '...',
      type: 'website',
      url: 'https://elenvo.ai/page',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Page Title | Elenvo',
      description: '...',
    },
  }
  ```
- Add canonical URLs via metadata API
- Create `app/robots.ts` and `app/sitemap.ts` if missing
- Use semantic HTML (`<main>`, `<nav>`, `<header>`, `<footer>`, `<article>`)
- Ensure every page has exactly one `<h1>`

### DO NOT TOUCH

- Third-party scripts (Stripe.js, Plaid Link, analytics SDKs) — mark as **"external, out of scope"**
- Inline scripts injected by third-party services
- Performance overhead from Supabase/OpenAI API calls (network-dependent)

## STEP 5: RE-RUN LIGHTHOUSE

After making fixes:

```bash
# Kill old server
kill $SERVER_PID 2>/dev/null

# Rebuild and restart
npm run build
npm run start &
SERVER_PID=$!
sleep 5

# Run Lighthouse again (3 runs, median) on all tested pages
# ... same as Step 2
```

### Compare before/after scores for each page and category

**Decision logic:**

- **ALL 4 categories >= 90 on ALL pages** → PASS → go to Step 6
- **Scores improved but still < 90 in some categories** → go back to Step 4, fix next set of opportunities
- **Scores did NOT improve or REGRESSED** → revert the last change (`git checkout -- <files>`), try a different approach
- **A fix improved one category but regressed another** → revert that specific fix, find an alternative that doesn't regress

### Maximum 5 iterations total

- Each fix typically improves scores by 2-5 points
- Going from 60 → 90 may need 4-5 rounds of fixes
- Lighthouse has ±3-5 point variance — the 3-run median reduces noise
- **Early exit**: if 2 consecutive rounds show no meaningful improvement (< 2 points), stop and report remaining opportunities
- After 5 iterations, stop regardless and report final state

## STEP 6: CLEANUP AND REPORT

### Cleanup

```bash
# Kill the production server
kill $SERVER_PID 2>/dev/null

# Optionally clean up .lighthouse/ directory
# rm -rf .lighthouse
```

### Final Report

Present results as a before/after table for each page:

```
| Page       | Category        | Before | After | Delta | Status |
|------------|-----------------|--------|-------|-------|--------|
| /          | Performance     | 72     | 91    | +19   | PASS   |
| /          | Accessibility   | 85     | 95    | +10   | PASS   |
| /          | Best Practices  | 88     | 92    | +4    | PASS   |
| /          | SEO             | 67     | 91    | +24   | PASS   |
| /dashboard | Performance     | 65     | 90    | +25   | PASS   |
| /dashboard | Accessibility   | 90     | 93    | +3    | PASS   |
| /dashboard | Best Practices  | 78     | 91    | +13   | PASS   |
| /dashboard | SEO             | 72     | 92    | +20   | PASS   |
```

Then provide:

1. **Optimizations made** — list each change with a brief explanation of why it helps
2. **Remaining opportunities** — anything left on the table, with estimated difficulty (easy/medium/hard)
3. **Out of scope items** — third-party scripts and external factors that can't be optimized here
4. **Exit status**: one of:
   - **ALL 90+** — every category on every page meets the threshold
   - **PARTIAL** — some categories improved to 90+ but others remain below (list which)
   - **NEEDS ATTENTION** — significant categories still below 90, likely requires architectural changes

### Special case: scores 85-89 with diminishing returns

If a category is 85-89 and the only remaining opportunities are:

- Third-party scripts (out of scope)
- Sub-100ms improvements (diminishing returns)
- Require architectural changes beyond reasonable scope

Then explain this to the user and let them decide whether to accept or push further.

## KEY RULES

1. **ALWAYS production build** — `npm run build && npm run start` — NEVER `npm run dev`
2. **3 runs per page, take median** — reduces Lighthouse variance
3. **Don't touch third-party scripts** — mark as out of scope
4. **Rebuild before every re-run** — code changes need a fresh production build
5. **Revert regressions immediately** — fixing Performance must not break Accessibility
6. **Prefer Next.js built-ins** — next/image, next/font, Metadata API over manual solutions
7. **SEO uses Metadata API** — `export const metadata` or `generateMetadata()`, not manual `<meta>` tags
8. **Don't break above-fold content** — be careful with dynamic imports on hero sections
9. **Kill the server when done** — always clean up the background process
10. **Max 5 iterations** — stop and report if target isn't reached
