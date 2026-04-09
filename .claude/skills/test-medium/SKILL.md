---
name: test-medium
description: Unit + property tests verified by mutation testing with AI self-improvement loop
user-invocable: true
---

# Mutation-Verified Testing (Unit + Property + Mutation)

You are running a mutation-verified testing workflow. The core idea: use StrykerJS mutation testing to ensure tests actually catch real bugs, not just pass trivially. You will iterate up to 3 rounds, improving tests each round until the mutation score reaches >= 80%.

## Step 0: SCOPE DETECTION

Determine which files to test:

1. If the user provided specific file paths as arguments, use those.
2. Otherwise, detect changed source files:
   ```bash
   git diff --name-only HEAD
   git diff --name-only --cached
   ```
3. Filter to source files that match StrykerJS mutate globs: `lib/**/*.ts` and `app/api/**/*.ts` (excluding `*.test.ts`, `*.spec.ts`, `*.d.ts`).
4. If NO source files match those globs, warn the user:
   > "No changed files match Stryker's mutate paths (lib/**/\*.ts, app/api/**/\*.ts). Mutation testing only covers those directories. Running unit tests only."
   > Then run just Step 1 and skip to Step 5.
5. Find corresponding test files in `__tests__/` or `__tests__/property/` for the changed source files. Also check for co-located `.test.ts` / `.test.tsx` files.

## Step 1: RUN BASELINE

Run Vitest scoped to the relevant test files:

```bash
npx vitest run --reporter=verbose <test-file-paths>
```

- If ALL tests pass → proceed to Step 2.
- If any tests FAIL:
  - Read the failing test file and the source file it tests.
  - Determine if the failure is a **test bug** (incorrect assertion, outdated mock, wrong import) or a **source bug** (actual code defect).
  - If test bug → fix the test. NEVER modify source code.
  - If source bug → report it to the user with file path, line number, and explanation. Do NOT fix source code.
  - Re-run the failing tests. Max 2 fix attempts per test file.
  - If still failing after 2 attempts → report the failure and continue with passing tests.

## Step 2: MUTATION TEST

Run StrykerJS scoped to the changed source files using the `--mutate` flag:

```bash
npx stryker run --mutate "{file1.ts,file2.ts}"
```

For a single file:

```bash
npx stryker run --mutate "lib/utils.ts"
```

IMPORTANT: ALWAYS scope with `--mutate`. Never run unscoped `npx stryker run` — it mutates the entire project and takes too long.

Parse the clear-text reporter output. It shows each mutant with format:

```
#1. [Survived] ConditionalExpression
src/file.ts:42:5
-   if (x > 0) {
+   if (false) {
```

Extract:

- **Mutation score** (percentage)
- **Killed** count
- **Survived** count (these need new/better assertions)
- **Timeout** count (usually acceptable)
- **No coverage** count (test doesn't even execute this code path)
- List of each surviving mutant with: type, file, line, original vs mutated code

## Step 3: ANALYZE SURVIVING MUTANTS

If mutation score >= 80% → PASS, skip to Step 5.

If score < 80%, categorize each surviving mutant:

| Category          | Examples                             | Priority                    |
| ----------------- | ------------------------------------ | --------------------------- |
| Logic/Conditional | `if(x)` → `if(false)`, `&&` → `\|\|` | HIGH — these hide real bugs |
| Boundary          | `>` → `>=`, `<` → `<=`               | HIGH — off-by-one errors    |
| Return value      | `return true` → `return false`       | HIGH — inverted logic       |
| Arithmetic        | `+` → `-`, `*` → `/`                 | MEDIUM                      |
| Equality          | `===` → `!==`                        | MEDIUM                      |
| String/literal    | `"error"` → `""`                     | LOW                         |
| Removal           | block/statement removed              | Depends on what was removed |

**Acceptable mutants** (do NOT count against the score target):

- `console.log` / `console.error` / `console.warn` statements
- Error message string literal changes (the exact wording doesn't affect correctness)
- Logging-only code paths

For each HIGH/MEDIUM surviving mutant, determine what specific test assertion would kill it. Be precise — name the test case, the input values, and the expected output.

## Step 4: IMPROVE TESTS

Based on the analysis, add or strengthen test assertions:

1. **Target high-priority surviving mutants first.** Each new assertion should kill at least one specific mutant.
2. **Add boundary test cases** for boundary mutants (e.g., test the exact boundary value, one above, one below).
3. **Add negative test cases** for conditional mutants (test what happens when the condition is false).
4. **Add return value checks** for return value mutants (assert the specific return value, not just truthiness).
5. **Consider property-based tests** (fast-check) for functions with numeric/string inputs — these kill many mutant types at once. Place property tests in `__tests__/property/`.

Rules:

- ONLY modify test files. NEVER modify source code.
- Do NOT add trivial assertions just to bump the score (e.g., `expect(true).toBe(true)`).
- Do NOT duplicate existing test logic — strengthen existing tests or add targeted new cases.
- Use the project's existing test patterns: `@/` path alias, `vi.mock()` for mocking, `describe/it` blocks.
- Import from source using the same patterns as existing tests in the project.

After modifying tests, output progress:

```
Round X/3: targeting Y surviving mutants with Z new/modified assertions
```

Then go back to **Step 1** (re-run baseline to confirm tests still pass, then re-run mutation).

## Step 5: REPORT

Output a clear summary:

```
## Mutation Testing Results

**Status**: PASS | NEEDS ATTENTION | MAX ITERATIONS REACHED

### Mutation Score
- Before: XX% → After: YY%
- Killed: N / Total: M
- Survived: S (of which A are acceptable)
- Timed out: T
- No coverage: C

### Rounds
- Round 1: XX% → YY% (N mutants killed)
- Round 2: YY% → ZZ% (N mutants killed)

### Remaining Surviving Mutants (if any)
| # | File:Line | Mutation Type | Why Acceptable |
|---|-----------|--------------|----------------|
| 1 | lib/foo.ts:42 | StringLiteral | Error message text |

### Test Files Modified
- __tests__/lib/foo.test.ts (added 3 assertions)
- __tests__/property/foo.property.test.ts (new file, 2 property tests)
```

Exit statuses:

- **PASS**: Mutation score >= 80% on all scoped files
- **NEEDS ATTENTION**: Score is 70-80% with explanations for remaining mutants
- **MAX ITERATIONS REACHED**: 3 rounds completed, score still < 70%

## Iteration Control

- **Max rounds**: 3
- **Early exit**: If the mutation score does not improve between two consecutive rounds (or improves by less than 2 percentage points), stop iterating — further rounds won't help.
- **Per-round output**: Always print the round number, before/after score, and number of mutants killed that round.

## Critical Rules

1. **Never modify source code.** Only test files.
2. **Always scope Stryker** with `--mutate` flag. Never run full-project mutation.
3. **Parse Stryker output carefully.** The clear-text reporter shows each mutant — use this to guide test improvements.
4. **Quality over quantity.** A test that kills 5 mutants is better than 5 tests that each kill 1.
5. **Report source bugs.** If a surviving mutant reveals that the source code has a real bug (e.g., a condition that should be `>=` but is `>`), report it to the user rather than writing a test that enshrines the bug.
6. **Respect existing test patterns.** Read existing test files before writing new ones to match the project's style.
