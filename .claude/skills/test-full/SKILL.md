---
name: test-full
description: Complete test suite — unit, property, integration, e2e, mutation, and coverage audit
user-invocable: true
---

# /test-full — Complete Test Suite & Coverage Audit

You are running the **full quality gate** for the Elenvo project. This is the most thorough test pass, intended to run before PRs or merges. It includes a coverage debt audit, all test types, mutation testing, and a final dashboard report.

**Total budget**: ~10 test command runs max across all stages. If everything passes on first try, report success quickly — don't loop unnecessarily.

**Critical rule**: You may only modify **test files** — NEVER modify source code. If source code has a real bug, report it to the user.

---

## Project Context

- **Framework**: Next.js (App Router), TypeScript strict, React 19
- **Unit/Property tests**: Vitest (jsdom, globals, v8 coverage, 80% thresholds) — config in `vitest.config.ts`
- **E2E tests**: Playwright (chromium, `e2e/` directory, webServer auto-starts dev) — config in `playwright.config.ts`
- **Mutation tests**: StrykerJS (vitest runner, TypeScript checker) — config in `stryker.config.json`
- **Test directories**: `__tests__/` (unit, components, property), `e2e/` (Playwright)
- **Path alias**: `@/*` → project root
- **Coverage thresholds**: 80% (lines, functions, branches, statements)

---

## Execution Plan

Run each stage independently. Failure in one stage does NOT skip others. Aggregate all results for the final report.

### Step 0: COVERAGE DEBT AUDIT

This step catches untested code from **previous** changes — not just the current diff. This is the unique value of `/test-full`.

1. Run: `npx vitest run --coverage 2>&1`
2. Parse the coverage summary output (look for the table with `% Stmts`, `% Branch`, `% Funcs`, `% Lines`)
3. **If overall coverage >= 80%** → Note the numbers and skip to Step 1
4. **If overall coverage < 80%**:
   a. Parse the coverage report to find files with the **lowest coverage**, sorted by uncovered lines
   b. Prioritize files that are: (i) business-critical (`lib/`, `app/api/`), (ii) have 0% or very low coverage
   c. Read the top 5 lowest-covered source files to understand what they do
   d. Write tests for those files in the appropriate `__tests__/` subdirectory
   e. Re-run: `npx vitest run --coverage 2>&1`
   f. If still < 80%, do ONE more round (max 2 audit rounds total)
5. Record coverage numbers and proceed to Step 1 regardless of outcome

### Step 1: UNIT + PROPERTY TESTS

1. Run: `npx vitest run 2>&1`
2. Parse output for pass/fail counts
3. **If all pass** → Record results, move to Step 2
4. **If failures**:
   a. Read the failing test files and the source files they test
   b. Analyze whether the failure is:
   - **Test issue** (outdated assertion, wrong mock, stale snapshot) → Fix the test
   - **Source bug** → Do NOT fix source code. Note it for the report.
     c. Re-run: `npx vitest run 2>&1`
     d. Max 2 fix attempts, then move on
5. Check if property-based tests exist (look for `fast-check` imports in `__tests__/property/` or similar)
   - If they exist, they already ran with vitest — note their results separately
   - If none exist, note "No property tests found" in the report

### Step 2: INTEGRATION TESTS

1. Check if integration tests exist:
   - Look for `__tests__/integration/` directory
   - Look for files matching `*.integration.test.ts` or `*.integration.test.tsx`
2. **If no integration tests found** → Report "⏭️ Integration Tests: skipped (none found)" and move to Step 3
3. **If integration tests exist**:
   a. Run them (they may need specific vitest config or test pattern)
   b. **If failures**:
   - **Test issue** → Fix the test (max 2 attempts)
   - **API/DB issue** (Supabase connection, schema mismatch) → Report to user, do NOT auto-fix
     c. Record results

### Step 3: E2E TESTS

1. Run: `npx playwright test 2>&1`
   - Playwright config has `webServer` configured to auto-start `npm run dev`
   - If it fails to start the dev server, check if port 3000 is already in use
2. Parse output for pass/fail counts
3. **If all pass** → Record results, move to Step 4
4. **If failures**:
   a. Check for Playwright trace/screenshot output in `test-results/` or `playwright-report/`
   b. Read the failing test files and analyze:
   - **Outdated test** (selector changed, flow changed, text changed) → Update the test
   - **Real regression** (feature actually broken) → Report to user, do NOT fix source code
     c. Re-run: `npx playwright test 2>&1`
     d. Max 2 fix attempts, then move on

### Step 4: MUTATION TESTING

1. Determine which source files have changed:

   ```bash
   git diff --name-only HEAD~5 -- 'lib/**/*.ts' 'app/api/**/*.ts' 'app/**/*.tsx' 'components/**/*.tsx' | head -20
   ```

   - If no changed files found, use the default stryker mutate pattern from config

2. Run mutation testing scoped to changed files:

   ```bash
   npx stryker run --mutate "<file1>,<file2>,..." 2>&1
   ```

   - If the file list is too long or empty, run: `npx stryker run 2>&1` (uses config defaults)

3. Parse the mutation score from output
4. **If mutation score >= 80%** → Record and move to Step 5
5. **If mutation score < 80%**:
   a. Read the Stryker report to find which mutants survived
   b. Identify the source files with the most surviving mutants
   c. Read those source files and their corresponding test files
   d. Write additional test cases that would kill the surviving mutants (focus on: boundary conditions, negation, operator replacement, early returns)
   e. Re-run mutation testing
   f. Max 3 iterations total for this step
6. Record final mutation score

### Step 5: FINAL COVERAGE CHECK

1. Run: `npx vitest run --coverage 2>&1`
2. Parse and check:
   - **Changed files coverage >= 80%** — HARD GATE
   - **Overall project coverage >= 80%** — HARD GATE
   - **Overall project coverage >= 90%** — STRETCH (report but don't block)
3. To check changed files specifically:
   ```bash
   git diff --name-only HEAD~5 -- '*.ts' '*.tsx' | grep -v '__tests__\|\.test\.\|\.spec\.\|e2e/'
   ```
   Cross-reference these files against the coverage report output
4. Record all coverage numbers

### Step 6: FINAL REPORT

Generate a dashboard-style summary. Use this exact format:

```
## 🧪 Test Suite Report — /test-full

| Stage | Status | Details |
|-------|--------|---------|
| Unit Tests | ✅/❌ | X/Y pass |
| Property Tests | ✅/⏭️ | X/Y pass (or "skipped — none found") |
| Integration Tests | ✅/⏭️ | X/Y pass (or "skipped — none found") |
| E2E Tests | ✅/❌ | X/Y pass |
| Mutation Score | ✅/❌ | XX% (target: 80%) |
| Changed Files Coverage | ✅/❌ | XX% (target: 80%) |
| Overall Coverage | ✅/❌ | XX% (target: 80%) |
| Stretch: Overall Coverage | ⭐/➖ | XX% (target: 90%) |
| Stretch: Mutation Score | ⭐/➖ | XX% (target: 90%) |

### Auto-fixed by AI
- [list each test file modified and what was changed, or "None — all tests passed on first run"]

### ⚠️ Needs User Attention
- [list any real bugs found, source code issues, infra problems, or "None — all clear"]

### Verdict: ALL PASS ✅ / PARTIAL PASS ⚠️ / NEEDS ATTENTION ❌
```

**Verdict logic**:

- **ALL PASS** ✅ — All hard gates met, no issues needing user attention
- **PARTIAL PASS** ⚠️ — Some hard gates met but not all, OR some tests were auto-fixed (user should review fixes)
- **NEEDS ATTENTION** ❌ — Hard gates failed and couldn't be auto-fixed, OR real source bugs found

---

## Hard Gates (ALL must pass for "ALL PASS")

- All unit tests pass
- All property-based tests pass (or none exist)
- All integration tests pass (or none exist)
- All E2E tests pass
- Mutation score >= 80% (scoped to changed files)
- Changed files coverage >= 80%
- Overall project coverage >= 80%

## Stretch Goals (reported, not blocking)

- Overall coverage >= 90%
- Mutation score >= 90%

---

## Important Rules

1. **Never modify source code** — only test files. Report source bugs to the user.
2. **Each stage is independent** — run all stages even if earlier ones fail.
3. **Max 2 fix attempts per stage** (except mutation: max 3). Don't burn the iteration budget.
4. **Fast path**: If all stages pass on first try, skip straight to the report. Don't loop unnecessarily.
5. **Gracefully handle missing test types** — skip with a note, don't fail the whole suite.
6. **For E2E**: Playwright config has `webServer` to auto-start dev server. If port 3000 is occupied, note it.
7. **Coverage audit (Step 0) is the unique value** — it catches debt from ALL previous changes, not just current diff.
8. **Be specific in the report** — file names, line numbers, exact error messages. The user should be able to act on the report immediately.
9. **Timeout awareness**: Mutation testing can be slow. If `stryker run` takes more than 10 minutes, consider narrowing the mutate scope.
10. **Run commands with `2>&1`** to capture both stdout and stderr for analysis.
