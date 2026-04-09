---
name: ux-apply
description: Implement changes to align code with UX design files (product-ia.md, product-flows.md, product-interactions.md). Reads design specs and modifies code to match.
user-invocable: true
---

# /ux-apply — Apply UX Design to Code

You are implementing changes to align the codebase with the UX design files in `design/`. Your job is to read the design specs, find where code doesn't match, and fix it — with user approval at every step.

## Arguments

`/ux-apply [optional scope]`

The user may provide additional context after the command:
- `/ux-apply` → Fix all gaps between design files and code
- `/ux-apply fix all stubs` → Only fix stub/placeholder handlers
- `/ux-apply IA only` → Only apply Information Architecture changes
- `/ux-apply financial-overview page` → Only fix issues on a specific page

If args are provided, narrow your scope accordingly. If no args, apply all.

## Hard Rules

- NEVER modify accepted tradeoffs listed in design files.
- NEVER make changes the user hasn't approved.
- NEVER modify design files without asking.
- Always preserve existing functionality — no regressions.
- Keep changes minimal. Fix what the design files specify, nothing more.
- Follow all project coding conventions (TypeScript strict, shadcn/ui, etc.).
- Maximum 3 fix-verify iterations per issue. If stuck, report and move on.

## Project Context

This skill assumes:
- Next.js App Router project (routes in `app/` directory)
- Navigation defined in `components/layout/`
- Design files in `design/` directory
- TypeScript strict mode, shadcn/ui components

Adapt if the project structure differs.

## Prerequisites

The `design/` directory must exist with at least one of:
- `design/product-ia.md`
- `design/product-flows.md`
- `design/product-interactions.md`

If no design files exist, tell the user: "No design files found. Run `/ux-review` first to generate them."

## Workflow

### Step 1: Load Design Files

Read all design files in `design/`. Extract:
- Intended product structure (routes, nav, content grouping)
- Expected user flows (steps, paths)
- Interaction specs (what each button/form should do)
- Accepted tradeoffs (do NOT touch these)

### Step 2: Scan Current Code

Read the codebase to understand its current state. Compare against the design files.

### Step 3: Identify Gaps

Find where code does NOT match design files. Present as a structured table:

```
| Type | Severity | File:Line | Gap | Planned Fix |
|------|----------|-----------|-----|-------------|
| VIOLATION | ❌ | foo.tsx:234 | Stub handler, design says real Plaid | Replace with BankLinkButton |
| GAP | ⚠️ | sidebar.tsx:30 | Missing /tax nav item, design requires it | Add nav entry |
```

Skip `ACCEPTED` tradeoffs — do not flag or fix them.

### Step 4: Confirm with User

Show the gap table and ask:
> "Here are the changes I'll make. Proceed? (yes/no)"

Do NOT proceed without explicit approval.

### Step 5: Execute

Implement changes to align code with design files:
- Modify route structure if IA requires it
- Update navigation components
- Replace stub handlers with real implementations
- Fix user flow paths
- Add missing empty states
- Correct content grouping

Maximum 3 fix-verify iterations per issue. If a fix doesn't work after 3 attempts, report it and move on.

### Step 6: Verify

After changes:
- Run `npx tsc --noEmit` for TypeScript check
- Run affected tests with `npx vitest run`
- Report results:

```
| Check | Status |
|-------|--------|
| TypeScript | ✅ 0 errors |
| Tests | ✅ 2220/2220 pass |
| Lint | ⚠️ 7 warnings (pre-existing) |
```

If tests fail, fix within the 3-iteration budget.

### Step 7: Update Design Files

If the implementation revealed new information or tradeoffs:
- Update the relevant design file(s) with current state
- Add/update `## Last Applied: [timestamp]`
- Ask user before saving changes to design files

### Step 8: Summary

Present final report:

```
| Issue | Status |
|-------|--------|
| Stub handler in financial-overview | ✅ Fixed |
| Missing /tax nav entry | ✅ Fixed |
| Welcome wizard dismissible | ⚠️ Skipped (accepted tradeoff) |
```

Verdict: `✅ CODE ALIGNED WITH DESIGN` or `⚠️ [N] issues remaining`
