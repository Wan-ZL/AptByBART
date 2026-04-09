---
name: test-fast
description: Quick unit + property-based test run with AI auto-fix loop
user-invocable: true
---

# /test-fast — Quick Test Verification

You are running a fast test verification cycle. Your goal: detect what changed, run scoped tests, fix broken tests (NOT source code), generate missing tests, and report results. Target: ~15 seconds for the test run itself.

## Step 0: PARSE ARGUMENTS

Check if the user passed file paths as arguments (e.g., `/test-fast src/lib/calculations.ts`).

- If arguments provided → use those as the changed file list, skip auto-detection in Step 1.
- If no arguments → proceed to Step 1 auto-detection.

## Step 1: DETECT SCOPE

Run these commands to find changed files:

```bash
# Unstaged changes
git diff --name-only
# Staged changes
git diff --name-only --cached
# Untracked files (new files)
git ls-files --others --exclude-standard
```

Combine and deduplicate results. Filter to only source files: `*.ts`, `*.tsx` (exclude config files, test files themselves, markdown, CSS-only changes).

If **no changed source files detected**:
→ Tell the user: "No changed source files detected. Nothing to test."
→ Exit gracefully.

### Map source files to test files

For each changed source file, find corresponding test files using these conventions:

| Source file pattern          | Test file locations                                               |
| ---------------------------- | ----------------------------------------------------------------- |
| `app/**/*.tsx`               | `__tests__/components/**/*.test.tsx` (match by component name)    |
| `app/**/*.ts` (route/action) | `__tests__/api/**/*.test.ts` or co-located `*.test.ts`            |
| `components/**/*.tsx`        | `__tests__/components/**/*.test.tsx` (match by component name)    |
| `lib/**/*.ts`                | `__tests__/lib/**/*.test.ts` or `__tests__/property/**/*.test.ts` |
| Any file                     | Co-located `<name>.test.ts` / `<name>.test.tsx` next to source    |

Use `find` or glob patterns to locate existing test files. Build a list of:

- **Existing test files** that correspond to changed source files
- **Missing test files** where no test exists for a changed source file

## Step 2: GENERATE MISSING TESTS

For each changed source file that has **no corresponding test file**:

1. Read the source file to understand exports and behavior.
2. Generate a test file following these rules:

**Test file conventions:**

- Place in `__tests__/` mirroring the source structure, or co-located if that's the existing pattern nearby.
- Import from `@/...` using the path alias.
- Use `describe` / `it` blocks with clear test names describing behavior.
- For React components: use `@testing-library/react` with `render`, `screen`, `userEvent`. Test user-visible behavior, NOT implementation details (no testing internal state, no `wrapper.instance()`).
- For utility functions: test happy path, edge cases, boundary values, error cases.
- For API routes: mock Supabase client, test response status codes and body shape.
- **MEANINGFUL ASSERTIONS ONLY** — never write `expect(true).toBe(true)`, snapshot-only tests, or tests that just check "it renders without crashing" with no assertions on content.
- Use `vi.mock()` sparingly — prefer real implementations where possible. Mock only external services (Supabase, Stripe, OpenAI, fetch).

3. Log: `"Creating new test file: <path>"`

## Step 3: REVIEW EXISTING TESTS

For each existing test file that maps to a changed source file:

1. Read both the source file diff (`git diff <source-file>`) and the test file.
2. Check if existing tests still align with the source:
   - Are there tests for functions/components that were renamed or removed?
   - Are there new exports or behaviors that have no test coverage?
   - Do mocks match current function signatures?
3. If tests need updating → update them. Log: `"Updating test: <path> — <reason>"`
4. If tests are still valid → leave them alone.

## Step 4: RUN TESTS (Iteration Loop)

Run scoped tests (NOT the full suite, NOT watch mode):

```bash
npx vitest run <space-separated list of test file paths>
```

If **all tests pass** → go to Step 5.

If **any tests fail**, analyze each failure:

### Failure triage:

- **Test is wrong** (bad assertion, outdated mock, wrong import, stale snapshot) → fix the test file.
- **Source code has a bug** (test expectation is correct but source returns wrong value) → do NOT fix source code. Add to report as "needs user attention".

Log: `"Round N/3: fixing X failing tests..."`

After fixing, re-run the same test command. **Maximum 3 iterations.** If tests still fail after 3 rounds → stop and report remaining failures.

**CRITICAL: Never modify source files. Only modify test files.**

## Step 5: PROPERTY-BASED TESTS

Check if any changed source files contain:

- Numeric calculations (amounts, percentages, scores, rates)
- Input validation logic (form validators, parsers, sanitizers)
- Data transformations (mapping, filtering, formatting)
- String processing (slugify, truncate, template rendering)

If yes, check if property-based tests already exist in `__tests__/property/`.

If no property tests exist for the changed logic:

1. Generate property tests using `fast-check`:

```typescript
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

describe('functionName property tests', () => {
  it('should satisfy <property description>', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        // Test invariant
        const result = functionName(n)
        expect(result).toSatisfy(/* invariant check */)
      })
    )
  })
})
```

2. Place in `__tests__/property/<module-name>.property.test.ts`
3. Use reasonable generators — don't generate astronomically large values unless testing overflow behavior.
4. Test real invariants: idempotency, commutativity, round-trip encoding/decoding, output range, monotonicity, etc.

Run property tests with the same iteration loop (max 3 rounds).

## Step 6: REPORT

Print a clear summary:

```
═══════════════════════════════════════
  /test-fast Results
═══════════════════════════════════════
  Changed files scoped:  N
  Tests run:             N
  Tests passed:          N  ✓
  Tests failed:          N  ✗
  New tests created:     N
  Tests updated:         N
  Property tests:        N
───────────────────────────────────────
  Status: PASS | NEEDS ATTENTION | MAX ITERATIONS REACHED
═══════════════════════════════════════
```

If status is **NEEDS ATTENTION**, list each issue:

- Source bugs detected (test is correct, source is wrong)
- Tests that couldn't be fixed within 3 iterations
- Files that couldn't be mapped to tests

If status is **PASS**, just show the summary — no extra commentary needed.
