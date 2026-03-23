# Cost Estimation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add live cost estimation to the HUD, showing approximate session spend based on model-specific token pricing.

**Architecture:** A `pricing.ts` module holds per-model pricing tables (input, output, cache write, cache read per MTok). `index.ts` builds a `CumulativeTokenUsage` object from the stdin token snapshot and calls `calculateCost()`. A `cost.ts` render component displays it as `Cost ~$1.42` with color thresholds (dim <$0.10, green <$1, yellow <$5, red >$5). The cost is an estimate from the current context window — it doesn't track cumulative cross-model usage (stdin only shows the active model's tokens). This limitation is documented, not hidden.

**Tech Stack:** TypeScript 5, Node.js 18+, ESM modules.

**Source reference:** The rogue subagent built this in commit `9c47041` (now dropped). The compiled output lives in the marketplace cache at `~/.claude/plugins/cache/claude-hud/claude-hud/0.0.8/dist/pricing.js` and `dist/render/lines/cost.js`. We're porting these back to TypeScript source with proper typing.

**CRITICAL — check-before-change rule:** The fork has diverged significantly from the cache version (asciiMode, format-helpers, contextVelocity, compactionEvent, countsHideAfterSeconds). Do NOT bulk-copy files. Apply changes surgically to the fork's current source.

---

### Task 1: Create pricing.ts

**Files:**
- Create: `src/pricing.ts`

**Step 1: Create the pricing module**

```typescript
/**
 * Session cost estimation based on model-specific pricing.
 * Prices from docs.anthropic.com/en/docs/about-claude/pricing (2026-03-22).
 * Enterprise plans billed at same API rates.
 *
 * Limitation: This estimates cost from the current context window snapshot.
 * It does not track cumulative tokens across model switches (e.g., haiku
 * subagents). The actual session cost shown by Claude Code at session end
 * will be higher for multi-model sessions.
 */

export interface ModelTokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface CumulativeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  byModel: ModelTokenUsage[];
}

export interface CostEstimate {
  totalCost: number;
  inputCost: number;
  outputCost: number;
}

interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheWritePerM: number;
  cacheReadPerM: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4.6 / 4.5
  'opus-4-6': { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.50 },
  'opus-4-5': { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.50 },
  // Opus 4.1 / 4.0 (legacy, higher pricing)
  'opus-4-1': { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.50 },
  'opus-4':   { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.50 },
  // Sonnet 4.x
  'sonnet-4-6': { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
  'sonnet-4-5': { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
  'sonnet-4':   { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
  // Haiku 4.5
  'haiku-4-5': { inputPerM: 1, outputPerM: 5, cacheWritePerM: 1.25, cacheReadPerM: 0.10 },
  'haiku':     { inputPerM: 1, outputPerM: 5, cacheWritePerM: 1.25, cacheReadPerM: 0.10 },
  // Generic fallbacks
  'opus':   { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.50 },
  'sonnet': { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
};

const DEFAULT_PRICING = MODEL_PRICING['opus'];

function findPricing(modelId: string): ModelPricing {
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) return pricing;
  }
  return DEFAULT_PRICING;
}

export function calculateCost(tokens: CumulativeTokenUsage): CostEstimate {
  let totalInputCost = 0;
  let totalOutputCost = 0;

  if (tokens.byModel.length > 0) {
    for (const m of tokens.byModel) {
      const pricing = findPricing(m.model);
      totalInputCost += (m.inputTokens / 1_000_000) * pricing.inputPerM;
      totalInputCost += (m.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerM;
      totalInputCost += (m.cacheReadTokens / 1_000_000) * pricing.cacheReadPerM;
      totalOutputCost += (m.outputTokens / 1_000_000) * pricing.outputPerM;
    }
  } else {
    const pricing = DEFAULT_PRICING;
    totalInputCost += (tokens.inputTokens / 1_000_000) * pricing.inputPerM;
    totalInputCost += (tokens.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerM;
    totalInputCost += (tokens.cacheReadTokens / 1_000_000) * pricing.cacheReadPerM;
    totalOutputCost += (tokens.outputTokens / 1_000_000) * pricing.outputPerM;
  }

  return {
    totalCost: totalInputCost + totalOutputCost,
    inputCost: totalInputCost,
    outputCost: totalOutputCost,
  };
}
```

**Step 2: Build**

Run: `npx tsc`
Expected: Zero errors (new file, no consumers yet).

**Step 3: Commit**

```bash
git add src/pricing.ts
git commit -m "feat: add pricing module with model-specific token rates"
```

---

### Task 2: Create cost render component

**Files:**
- Create: `src/render/lines/cost.ts`

**Step 1: Create the cost render component**

```typescript
import type { RenderContext } from '../../types.js';
import type { CumulativeTokenUsage } from '../../pricing.js';
import { dim, RESET } from '../colors.js';
import { formatTokens } from '../format-helpers.js';

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  if (cost < 10) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(1)}`;
}

function getCostColor(cost: number): string {
  if (cost > 5.00) return '\x1b[31m';  // red
  if (cost >= 1.00) return '\x1b[33m'; // yellow
  if (cost >= 0.10) return '\x1b[32m'; // green
  return '\x1b[2m';                     // dim
}

/** Expanded layout: "Cost ~$1.42" with optional token breakdown */
export function renderCostLine(ctx: RenderContext): string | null {
  const data = ctx.costData;
  if (!data) return null;

  const total = data.inputTokens + data.outputTokens + data.cacheWriteTokens + data.cacheReadTokens;
  if (total === 0) return null;

  const color = getCostColor(data.totalCost);
  const costStr = formatCost(data.totalCost);
  let result = `${dim('Cost')} ${color}~${costStr}${RESET}`;

  if (ctx.config?.display?.showCostBreakdown) {
    const inStr = formatTokens(data.inputTokens + data.cacheWriteTokens + data.cacheReadTokens);
    const outStr = formatTokens(data.outputTokens);
    result += dim(` (in: ${inStr}, out: ${outStr})`);
  }

  return result;
}

/** Compact layout: "~$1.42" inline segment */
export function renderCostSegment(ctx: RenderContext): string | null {
  const data = ctx.costData;
  if (!data) return null;

  const total = data.inputTokens + data.outputTokens + data.cacheWriteTokens + data.cacheReadTokens;
  if (total === 0) return null;

  const color = getCostColor(data.totalCost);
  return `${color}~${formatCost(data.totalCost)}${RESET}`;
}
```

Note: This file imports from `../../types.js` which needs `costData` on `RenderContext` — that's added in Task 3. Build will fail until Task 3 completes.

**Step 2: Commit (no build yet — types don't exist)**

```bash
git add src/render/lines/cost.ts
git commit -m "feat: add cost render component for expanded and compact layouts"
```

---

### Task 3: Add types and config options

**Files:**
- Modify: `src/types.ts` — add `CumulativeTokenUsage` import and `costData` field to `RenderContext`
- Modify: `src/config.ts` — add `showCost` and `showCostBreakdown` to display config

**Step 1: Update types.ts**

Add import at top (after existing imports):
```typescript
import type { CumulativeTokenUsage } from './pricing.js';
```

Add to `RenderContext` interface (after `compactionEvent`):
```typescript
  costData: CumulativeTokenUsage | null;
```

**Step 2: Update config.ts**

Add to `HudConfig.display` interface (after `asciiMode: boolean`):
```typescript
    showCost: boolean;
    showCostBreakdown: boolean;
```

Add to `DEFAULT_CONFIG.display` (after `asciiMode: false`):
```typescript
    showCost: true,
    showCostBreakdown: false,
```

Add validation in `mergeConfig` display block (after `asciiMode` validation):
```typescript
    showCost: typeof migrated.display?.showCost === 'boolean'
      ? migrated.display.showCost
      : DEFAULT_CONFIG.display.showCost,
    showCostBreakdown: typeof migrated.display?.showCostBreakdown === 'boolean'
      ? migrated.display.showCostBreakdown
      : DEFAULT_CONFIG.display.showCostBreakdown,
```

**Step 3: Build**

Run: `npx tsc`
Expected: Zero errors.

**Step 4: Commit**

```bash
git add src/types.ts src/config.ts
git commit -m "feat: add costData type and showCost/showCostBreakdown config options"
```

---

### Task 4: Wire cost into index.ts and render pipeline

**Files:**
- Modify: `src/index.ts` — compute cost, pass to RenderContext
- Modify: `src/render/lines/index.ts` — export cost components
- Modify: `src/render/index.ts` — render cost in expanded layout
- Modify: `src/render/session-line.ts` — render cost in compact layout

**Step 1: Update index.ts**

Add import at top:
```typescript
import { calculateCost } from './pricing.js';
import type { CumulativeTokenUsage } from './pricing.js';
```

Add cost computation after the `compactionEvent` line and before the `const ctx` construction:
```typescript
    // Compute cost estimation from stdin token data
    let costData: CumulativeTokenUsage | null = null;
    if (config.display.showCost !== false) {
      const usage = stdin.context_window?.current_usage;
      if (usage) {
        const modelId = stdin.model?.id ?? stdin.model?.display_name ?? 'opus';
        const tokens: CumulativeTokenUsage = {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          totalCost: 0,
          byModel: [{
            model: modelId,
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          }],
        };
        const estimate = calculateCost(tokens);
        tokens.totalCost = estimate.totalCost;
        costData = tokens;
      }
    }
```

Add `costData` to the ctx object.

**Step 2: Update render barrel export**

In `src/render/lines/index.ts`, add:
```typescript
export { renderCostLine, renderCostSegment } from './cost.js';
```

**Step 3: Update expanded layout renderer**

In `src/render/index.ts`, in the `renderExpanded()` function, after the usage line section:
```typescript
    const costLine = renderCostLine(ctx);
    if (costLine) {
      // Append to identity/usage line if present
      const lastIdx = lines.length - 1;
      if (lastIdx >= 0) {
        lines[lastIdx] += ` \u2502 ${costLine}`;
      } else {
        lines.push(costLine);
      }
    }
```

Import `renderCostLine` from `./lines/index.js`.

**Step 4: Update compact layout renderer**

In `src/render/session-line.ts`, add cost segment after the usage section and before the speed/duration section. Import `renderCostSegment` from `./lines/cost.js`:

```typescript
    // Cost estimation
    const costSegment = renderCostSegment(ctx);
    if (costSegment) {
      parts.push(costSegment);
    }
```

**Step 5: Build and test**

Run: `npx tsc`
Expected: Zero errors.

Run: `node --test tests/render.test.js tests/config.test.js`
Expected: All existing tests pass (83+30 pass, 2 pre-existing failures).

**Step 6: Smoke test**

```bash
echo '{"model":{"id":"claude-opus-4-6","display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000,"output_tokens":10000,"cache_creation_input_tokens":5000,"cache_read_input_tokens":30000},"context_window_size":200000},"cwd":"/tmp","transcript_path":""}' | node dist/index.js
```

Expected: HUD renders with cost line showing `Cost ~$0.XX`.

**Step 7: Commit**

```bash
git add src/index.ts src/render/lines/index.ts src/render/index.ts src/render/session-line.ts
git commit -m "feat: wire cost estimation into render pipeline (expanded + compact)"
```

---

### Task 5: Add cost element to elementOrder config

**Files:**
- Modify: `src/config.ts` — add `'cost'` to `HudElement` type and `DEFAULT_ELEMENT_ORDER`

**Step 1: Update config**

Add `'cost'` to the `HudElement` type union:
```typescript
export type HudElement = 'project' | 'context' | 'usage' | 'cost' | 'environment' | 'tools' | 'agents' | 'todos';
```

Add `'cost'` to `DEFAULT_ELEMENT_ORDER` (after `'usage'`):
```typescript
export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  'project',
  'context',
  'usage',
  'cost',
  'environment',
  'tools',
  'agents',
  'todos',
];
```

**Step 2: Build and test**

Run: `npx tsc && node --test tests/config.test.js`
Expected: All pass.

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add cost to element ordering config"
```

---

### Task 6: Build, full test, and final smoke test

**Step 1: Full build**

Run: `npx tsc`
Expected: Zero TypeScript errors.

**Step 2: Full test suite**

Run: `node --test tests/config.test.js tests/render.test.js tests/render-width.test.js tests/transcript.test.js tests/speed-tracker.test.js tests/stdin.test.js tests/terminal.test.js tests/git.test.js`
Expected: 170+ pass, 2 pre-existing failures.

**Step 3: Smoke test with realistic data**

```bash
echo '{"model":{"id":"us.anthropic.claude-opus-4-6-v1","display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":100000,"output_tokens":50000,"cache_creation_input_tokens":20000,"cache_read_input_tokens":500000},"context_window_size":1000000,"used_percentage":67},"cwd":"/tmp","transcript_path":""}' | node dist/index.js
```

Expected output includes:
- Context bar at 67%
- Cost showing ~$1.XX (500k cache reads at $0.50/M = $0.25, 100k input at $5/M = $0.50, 50k output at $25/M = $1.25, 20k cache write at $6.25/M = $0.125 ≈ $2.13 total)
