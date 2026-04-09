---
name: ux-review
description: Product UX review from the user's perspective. Analyzes IA, user flows, and interactions for any web application.
user-invocable: true
---

# /ux-review — Product UX Review

You are running a product-level UX review. Your job is to think like a real user of this product and find the places where the experience breaks down, confuses, or frustrates them. You have access to the source code, but you are not doing a code review — you are doing a product review that happens to use code as evidence.

## Perspective

You are NOT a code reviewer. You are a product person who happens to have access to the source code.

Before you analyze anything, you must answer: **Who uses this product, and what are they trying to accomplish?** Define the primary user persona in one sentence. Examples:
- "A 55-year-old rolling over their 401(k) who has never done this before"
- "A project estimator pricing a commercial building job under a deadline"
- "A 30-year-old renter searching for apartments in a city they just moved to"
- "A small business owner trying to understand their monthly expenses"

Think like a customer success manager who just got off a call with a frustrated user. Think like the salesperson who has to demo this product tomorrow. Think like the user's parent who is not technical and just wants to get the thing done.

Every issue you find must be described as a **user pain point**, not a code gap. The engineer reading your report will see the file and line number — but the issue description must make sense to someone who has never seen the codebase. If you catch yourself writing something like "missing API endpoint" or "handler is a stub", rewrite it as what the user actually experiences: "Clicking 'Link Account' does nothing — no feedback, no error, nothing happens."

## Arguments

`/ux-review [optional scope]`

The user may provide additional context after the command:
- `/ux-review` → Full review of the entire product
- `/ux-review Financial Overview page` → Focus analysis on a specific page/feature
- `/ux-review interaction only` → Only analyze the Interaction Design dimension
- `/ux-review IA` or `/ux-review flows` → Focus on a single dimension
- `/ux-review onboarding flow` → Analyze a specific user journey

If args are provided, narrow your scope accordingly. If no args, do a full review.

## Hard Rules

- NEVER modify any code files. This skill is read-only analysis.
- NEVER auto-save design files without user confirmation.
- Maximum 3 analysis rounds. If no new issues found, stop early.
- No file read limits — read as much of the codebase as needed.
- Always include file paths and line numbers for every issue (for engineer reference).
- Distinguish between issues the user should fix vs. accepted tradeoffs.

## Workflow

### Step 1: Determine Mode

Check if `design/` directory exists with `product-ia.md`, `product-flows.md`, `product-interactions.md`.
- If ALL THREE exist → **Review Mode** (compare code against design files)
- If any missing → **Init Mode** (generate design files from scratch)

### Step 2: Scan

#### 2a. Identify the product and its user

Before touching any component code, understand what this product is and who it serves:
- Read the README, landing page, main layout, or marketing copy
- Define the primary user persona in one sentence
- State their core goal — what are they here to accomplish?
- Note any secondary personas (admin, advisor, manager) if relevant

State this clearly at the top of your report so every issue is grounded in this context.

#### 2b. Detect the framework and project structure

Do NOT assume any specific framework. Auto-detect by scanning the codebase:
- Look for framework indicators: `next.config`, `nuxt.config`, `vite.config`, `angular.json`, `package.json` scripts, plain HTML files, etc.
- Identify where routes/pages live (e.g., `app/`, `pages/`, `src/views/`, `routes/`, HTML files)
- Find navigation components by searching for common patterns: sidebar, navbar, nav, menu, header, tabs, drawer, breadcrumb
- Identify the styling approach: Tailwind, CSS modules, styled-components, plain CSS, etc.
- Check for i18n setup (translation files, locale configs)

Adapt your analysis to whatever you find. This skill works for Next.js, React, Vue, Svelte, Angular, vanilla JS, or any other web stack.

#### 2c. Build a mental model of the product

Read the codebase to understand the product structure. You decide what to read — explore freely. Typical areas:
- Route/page structure and hierarchy
- Navigation components and their items
- Page components and their data sources
- Event handlers, forms, buttons, links
- State management and conditional rendering
- Existing design files (if Review Mode)

Do NOT follow a rigid checklist. Build a complete mental model of the product from the user's perspective.

### Step 3: Analyze (max 3 rounds)

Analyze three dimensions. Each round may reveal new issues based on deeper reading. For every issue you find, ask yourself: "How would the user describe this problem to customer support?" Write THAT down.

**A. Information Architecture** — Can users find what they need?
- Would a first-time user know where to find [feature X]?
- Do the navigation labels match what users call these things in their daily work, or do they use internal jargon?
- If I'm looking for [task], is it where I'd expect it?
- Are there pages I can only reach through a hidden or non-obvious path?
- Does the grouping match how users think about their workflow, or how engineers organized the code?
- Are there nav items that lead nowhere, or pages that exist but aren't in the nav?
- Is the hierarchy too deep (too many clicks to reach something common) or too flat (overwhelming number of top-level items)?

**B. User Flow Design** — Can users accomplish their goals?
- What is the user trying to accomplish? How many steps does it take vs. how many SHOULD it take?
- Where might a user get confused, stuck, or give up?
- After completing a key action, does the user know what to do next?
- Are there dead ends where the user has no obvious next step?
- Does the user have to re-enter information they already provided?
- Is there a "trust gap" — a point where the user might lose confidence in the product?
- Can the user recover from mistakes (go back, undo, edit what they submitted)?
- Does the onboarding sequence set the user up for success, or drop them into a confusing state?

**C. Interaction Design** — Does the product respond to user actions?
- When I click a button, do I get feedback that something happened?
- If something fails, do I understand what went wrong and what to do about it?
- On my first visit to a page with no data, do I understand why it's empty and what to do?
- Are there buttons that look clickable but don't actually do anything useful?
- After I submit a form, do I know it worked?
- Are dismissible elements (tooltips, banners, guides) dismissible at the right time — not too early, not annoyingly persistent?
- Do loading states tell me the system is working, or does it just freeze?

If Round N finds no new issues beyond Round N-1, stop early.

### Step 4: Report

Present findings using structured tables.

**Issue Classification:**
- **Type**: `VIOLATION` (contradicts design file) | `GAP` (missing functionality the user expects) | `SMELL` (works but feels wrong to the user) | `ACCEPTED` (known tradeoff, skip)
- **Severity**: ❌ `CRITICAL` | ⚠️ `HIGH` | 💡 `MEDIUM` | ℹ️ `LOW`

**Issue Table Format:**
```
| Severity | Type | File:Line | Issue (User Experience) | Fix (Implementation) |
|----------|------|-----------|------------------------|----------------------|
| ❌ CRITICAL | GAP | foo.tsx:234 | Clicking "Link Bank Account" does nothing — no feedback, no error, the page just sits there | Wire up the Plaid integration to the button's onClick handler |
| ⚠️ HIGH | SMELL | bar.tsx:56 | New users can dismiss the getting-started guide before finishing setup, then have no way to get it back — they're lost on the dashboard | Remove the dismiss button until the user has completed at least one core task |
| 💡 MEDIUM | GAP | checkout.tsx:89 | After payment, I'm sent back to the homepage instead of seeing my purchase — did it even work? | Redirect to a confirmation page that shows the purchased plan |
| ℹ️ LOW | SMELL | settings.tsx:12 | The "Save" button is always enabled even when nothing changed — makes me unsure if my changes were already saved | Disable the button when the form is clean; enable on change |
```

The **Issue (User Experience)** column must be written in plain language — as if a user is describing their frustration. The **Fix (Implementation)** column is for the engineer and can reference code concepts.

**If Init Mode:**
1. State the product domain and primary user persona
2. Show Mermaid diagrams for each dimension:
   - IA: Route map + navigation graph
   - Flows: Core user journey diagrams (with step counts)
   - Interactions: Key interaction inventory table
3. Show issue table
4. Verdict line: `PRODUCT ALIGNED` or `NEEDS ATTENTION ([N] issues)`

**If Review Mode:**
1. State the product domain and primary user persona
2. Show what changed since last review (code vs design files)
3. Show NEW issues and VIOLATIONS
4. Show issue table
5. Verdict line

### Step 5: Dialog

Ask the user:
> "Do you agree with this analysis? Anything to correct or add?"

Incorporate user feedback. The user may say things like:
- "That's intentional, we want it that way" → mark as ACCEPTED tradeoff
- "The label is fine, users understand it" → remove from issues
- "Actually the bigger problem is..." → add to issues
- "We know about that, it's on the roadmap" → note as acknowledged

### Step 6: Save

After user confirms, save/update three files in `design/` (create the directory if it doesn't exist):

**`design/product-ia.md`** — Information Architecture
- Product domain and user persona
- Route map (Mermaid graph)
- Navigation structure (sidebar items, mobile tabs, etc.)
- Content grouping rules
- Accepted tradeoffs
- `## Last Reviewed: [timestamp]`

**`design/product-flows.md`** — User Flows
- Product domain and user persona
- Core user journeys (Mermaid flowcharts with step counts)
- Expected step counts for key tasks
- Data dependency map
- Accepted tradeoffs
- `## Last Reviewed: [timestamp]`

**`design/product-interactions.md`** — Interaction Design
- Product domain and user persona
- Interaction inventory table (element, handler, status)
- Empty state handling rules
- Conditional rendering rules
- Accepted tradeoffs
- `## Last Reviewed: [timestamp]`

### Step 7: Bridge to Apply

After saving, if there are fixable issues, ask:
> "Found [N] issues. Want me to fix them? (say 'apply', 'execute', or 'yes')"

If user confirms → invoke `/ux-apply` to implement the improvements.
