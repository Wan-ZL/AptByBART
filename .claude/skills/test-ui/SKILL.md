---
name: test-ui
description: Visual regression testing with Playwright screenshots and AI-powered diff analysis
user-invocable: true
---

# Visual Regression Testing — `/test-ui`

You are performing visual regression testing on the Elenvo Next.js application. Your job is to capture screenshots of affected pages, compare them against baselines, identify regressions, fix CSS/layout issues, and update baselines for intentional changes.

## Arguments

The user may optionally pass specific routes as arguments (e.g., `/test-ui /dashboard /settings`). If provided, test ONLY those routes. Otherwise, auto-detect affected pages from git diff.

---

## Step 1: DETECT AFFECTED PAGES

If the user provided specific routes as arguments, use those and skip detection.

Otherwise, run `git diff --name-only` (include both staged and unstaged changes) and map changed files to routes:

| Changed file pattern                      | Routes to test                                      |
| ----------------------------------------- | --------------------------------------------------- |
| `app/(app)/dashboard/*`                   | `/dashboard`                                        |
| `app/(app)/settings/*`                    | `/settings`                                         |
| `app/(app)/onboarding/*`                  | `/onboarding`                                       |
| `app/(app)/retirement/*`                  | `/retirement`                                       |
| `app/(app)/insurance/*`                   | `/insurance`                                        |
| `app/(app)/financial-overview/*`          | `/financial-overview`                               |
| `app/(app)/my-plans/*`                    | `/my-plans`                                         |
| `app/(app)/ai-advisor/*`                  | `/ai-advisor`                                       |
| `app/(app)/advisors/*`                    | `/advisors`                                         |
| `app/(public)/page.tsx` or `app/page.tsx` | `/`                                                 |
| `app/(public)/sign-up/*`                  | `/sign-up`                                          |
| `components/layout/*`                     | ALL major routes (layout change affects everything) |
| `components/ui/*`                         | ALL major routes (shared component change)          |
| `app/globals.css`                         | ALL major routes (global style change)              |
| `tailwind.config.ts`                      | ALL major routes                                    |

The full list of major routes for "ALL" cases: `/`, `/dashboard`, `/settings`, `/onboarding`, `/retirement`, `/insurance`, `/financial-overview`, `/my-plans`, `/ai-advisor`, `/advisors`

Public routes (no auth needed): `/`, `/sign-up`
Authenticated routes (login required): `/dashboard`, `/settings`, `/onboarding`, `/retirement`, `/insurance`, `/financial-overview`, `/my-plans`, `/ai-advisor`, `/advisors`

Print a summary: "Testing X pages: /route1, /route2, ..."

If no routes are affected (e.g., only test files or docs changed), report "No UI-affecting changes detected" and exit.

---

## Step 2: CAPTURE SCREENSHOTS

### 2a: Ensure dev server is running

Check if localhost:3000 is already serving:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || true
```

If NOT running, start it in the background:

```bash
npm run dev &
```

Then wait for it to be ready (poll with curl, max 30 seconds).

### 2b: Ensure directories exist

```bash
mkdir -p .test-ui/current .test-ui/diff .test-ui/baseline
```

### 2c: Capture screenshots using Playwright MCP

For EACH affected route, capture at two viewports:

**Desktop (1280x720):**

1. Resize browser: `browser_resize` to width=1280, height=720
2. Navigate to the route: `browser_navigate` to `http://localhost:3000<route>`
3. Wait for page to fully render — use `browser_evaluate` to check:
   - `document.readyState === 'complete'`
   - No elements with `[data-loading="true"]` or `.animate-spin` visible
   - Wait 1 second after load for animations to settle
4. Take screenshot: `browser_take_screenshot`
5. Save the raw screenshot data to `.test-ui/current/<route-name>-desktop.png`

**Mobile (375x667):**

1. Resize browser: `browser_resize` to width=375, height=667
2. Navigate and wait (same as above)
3. Take screenshot and save to `.test-ui/current/<route-name>-mobile.png`

**Route name mapping** for filenames: strip leading `/`, replace `/` with `-`. Root `/` becomes `home`.
Examples: `/dashboard` → `dashboard`, `/financial-overview` → `financial-overview`, `/` → `home`

### 2d: Handle authentication for protected routes

Before capturing authenticated routes, you MUST log in first:

1. Navigate to `http://localhost:3000/sign-in` (or the login page)
2. Fill in test credentials:
   - Email: use `SUPABASE_TEST_EMAIL` env var, or fall back to `zelin@vt.edu`
   - Password: use `SUPABASE_TEST_PASSWORD` env var
3. Submit the form and wait for redirect
4. Verify auth by checking that the dashboard loads (not redirected to login)
5. Auth cookies persist across navigations — only need to log in once per session

If login fails (no test password available), skip authenticated routes and report which routes were skipped due to auth.

### 2e: Fallback if Playwright MCP is unavailable

If the Playwright MCP tools are not available, write a temporary Playwright script:

```typescript
// .test-ui/capture.ts — temporary script, delete after use
import { chromium } from 'playwright'

const routes = [
  /* detected routes */
]
const viewports = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 375, height: 667 },
]

async function capture() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  // Login if needed
  // ... (fill in auth flow)

  for (const route of routes) {
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000) // settle animations
      const safeName = route === '/' ? 'home' : route.slice(1).replace(/\//g, '-')
      await page.screenshot({
        path: `.test-ui/current/${safeName}-${vp.name}.png`,
        fullPage: false,
      })
    }
  }
  await browser.close()
}

capture()
```

Run with: `npx playwright test .test-ui/capture.ts` or `npx tsx .test-ui/capture.ts`
Delete the script after use.

---

## Step 3: COMPARE WITH BASELINES

Check if `.test-ui/baseline/` has any `.png` files.

### If NO baselines exist (first run):

- Copy all files from `.test-ui/current/` to `.test-ui/baseline/`
- Report: "Initial baselines captured for X pages (Y screenshots). Run `/test-ui` again after future changes to compare."
- Ensure `.test-ui/current/` and `.test-ui/diff/` are in `.gitignore` (baselines are committed)
- **Exit here** — nothing to compare on first run.

### If baselines exist:

For each screenshot in `.test-ui/current/`, find its matching baseline in `.test-ui/baseline/`.

**Pixel comparison approach** — write and run a small Node script using `pixelmatch`:

```javascript
// .test-ui/compare.mjs — temporary, delete after use
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const currentDir = '.test-ui/current'
const baselineDir = '.test-ui/baseline'
const diffDir = '.test-ui/diff'

const files = readdirSync(currentDir).filter((f) => f.endsWith('.png'))
const results = []

for (const file of files) {
  const baselinePath = `${baselineDir}/${file}`
  const currentPath = `${currentDir}/${file}`
  try {
    const baseline = PNG.sync.read(readFileSync(baselinePath))
    const current = PNG.sync.read(readFileSync(currentPath))
    const { width, height } = baseline
    const diff = new PNG({ width, height })
    const numDiffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
      threshold: 0.1,
    })
    const totalPixels = width * height
    const diffPercent = ((numDiffPixels / totalPixels) * 100).toFixed(2)
    writeFileSync(`${diffDir}/${file}`, PNG.sync.write(diff))
    results.push({ file, diffPercent: parseFloat(diffPercent), numDiffPixels, totalPixels })
  } catch (e) {
    results.push({ file, error: e.message })
  }
}

console.log(JSON.stringify(results, null, 2))
```

First ensure dependencies are available: `npm list pixelmatch pngjs 2>/dev/null || npm install --no-save pixelmatch pngjs`

Run: `node .test-ui/compare.mjs`

Parse the results. For each screenshot:

- **diff <= 0.5%** → PASS (acceptable variation — anti-aliasing, font rendering)
- **diff > 0.5%** → needs AI analysis (proceed to Step 4)
- **error (no baseline)** → new page, save as new baseline

Delete the temporary comparison script after use.

---

## Step 4: AI ANALYZE DIFFS

For each screenshot with diff > 0.5%, visually analyze the changes:

1. **Read the baseline image** (`.test-ui/baseline/<name>.png`) using the Read tool
2. **Read the current image** (`.test-ui/current/<name>.png`) using the Read tool
3. **Read the diff image** (`.test-ui/diff/<name>.png`) using the Read tool

Compare all three images carefully. Categorize the change:

### Category A: INTENTIONAL CHANGE

The visual diff matches the code change. Examples:

- You added a new section and it appears in the screenshot
- A color was changed and the screenshot reflects the new color
- A component was removed and it's gone from the screenshot

**Action:** Mark this baseline for update (Step 6).

### Category B: REGRESSION

An unintended visual change. Examples:

- Layout shifted — elements moved when they shouldn't have
- Overflow — text or elements extending beyond their containers
- Missing element — something disappeared that shouldn't have
- Spacing issues — padding/margin changed unexpectedly
- Z-index problems — elements overlapping incorrectly
- Responsive breakage — mobile layout broken

**Action:** Fix in Step 5.

### Category C: ACCEPTABLE VARIATION

Minor rendering differences not caused by code changes:

- Anti-aliasing differences
- Font rendering variations
- Sub-pixel rendering
- Animation captured at different frame

**Action:** Ignore (treat as PASS).

For EACH analyzed screenshot, print:

```
📸 <filename>: <CATEGORY> — <brief description of what changed>
```

---

## Step 5: FIX REGRESSIONS (Category B only)

For each regression identified:

1. **Identify the root cause**: Read the component and CSS files related to the affected page. Look at what changed in the git diff that could have caused this.

2. **Make a targeted fix**: Edit ONLY the CSS/layout properties needed. Common fixes:
   - Add `overflow-hidden` or `overflow-auto` for overflow issues
   - Fix `flex` / `grid` properties for layout shifts
   - Adjust `z-index` for stacking issues
   - Fix responsive classes (`sm:`, `md:`, `lg:`) for mobile regressions
   - Add missing `w-full`, `min-h-0`, `shrink-0` for sizing issues

3. **Re-capture**: Take new screenshots of ONLY the affected pages/viewports.

4. **Re-compare**: Run pixel comparison again on the fixed screenshots.

5. **Verify**: If diff is now <= 0.5% or categorized as intentional/acceptable, the fix worked.

**Maximum 3 iterations.** If a regression persists after 3 fix attempts, report it as needing user attention — it's likely a design-level decision, not a simple CSS bug.

---

## Step 6: UPDATE BASELINES

After all analysis and fixes are complete, collect all screenshots that need baseline updates:

- Intentional changes (Category A)
- Fixed regressions (now matching expected appearance)
- New pages (no previous baseline)

**IMPORTANT: Do NOT silently update baselines.** Present the full list to the user:

```
🔄 Baseline updates needed:

1. dashboard-desktop.png — INTENTIONAL: new stats card added to header
2. dashboard-mobile.png — INTENTIONAL: new stats card added to header
3. settings-desktop.png — FIXED REGRESSION: sidebar overlap corrected
4. home-desktop.png — NEW: first baseline capture

Confirm baseline updates? (These will be committed to .test-ui/baseline/)
```

Wait for user confirmation before copying current screenshots to baseline.

---

## Step 7: REPORT

Print a final summary table:

```
╔══════════════════════════════════╤═════════╤═════════╗
║ Page                             │ Desktop │ Mobile  ║
╠══════════════════════════════════╪═════════╪═════════╣
║ / (home)                         │ ✅ PASS │ ✅ PASS ║
║ /dashboard                       │ 🔄 UPD  │ 🔄 UPD  ║
║ /settings                        │ 🔧 FIX  │ ✅ PASS ║
╚══════════════════════════════════╧═════════╧═════════╝
```

Legend:

- ✅ PASS — no visual diff (or diff < 0.5%)
- 🔄 UPD — baseline updated (intentional change)
- 🔧 FIX — regression found and fixed
- ❌ FAIL — regression could not be auto-fixed (needs user attention)

Then summarize:

- **Baselines updated:** list with reasons
- **Regressions fixed:** list with what was changed
- **Needs attention:** list with what's wrong and why auto-fix failed (if any)

Final status line:

- `✅ VISUAL TEST PASSED` — all pages pass, no action needed
- `🔄 BASELINES UPDATED` — intentional changes captured (user confirmed)
- `❌ NEEDS ATTENTION` — unresolved regressions requiring user decision

---

## Cleanup

After the skill completes:

- Delete temporary scripts (`.test-ui/compare.mjs`, `.test-ui/capture.ts`)
- Keep `.test-ui/current/` (useful for manual inspection) but these are gitignored
- Keep `.test-ui/diff/` (useful for manual inspection) but these are gitignored
- Baselines in `.test-ui/baseline/` are the only committed artifacts

## .gitignore

Ensure these entries exist in the project `.gitignore`:

```
# visual regression testing
.test-ui/current/
.test-ui/diff/
```

Do NOT gitignore `.test-ui/baseline/` — baselines should be committed so the team shares the same visual reference.
