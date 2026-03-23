# Display Enhancements V2 — Competitive Parity

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 6 biggest feature gaps vs claudia-statusline and ccstatusline: burn rate, native rate limits, lines changed, compaction state machine, split speed tracking, and usable context percentage. Also improve cost display honesty.

**Architecture:** All features follow the existing pattern — file-based caches for cross-invocation state (since HUD runs as a new process every ~300ms), data collected in index.ts, passed through RenderContext, displayed in render files. The native rate_limits feature is the biggest win: eliminates the OAuth API call entirely for Claude Code v2.1.80+.

**Tech Stack:** TypeScript 5, Node.js 18+, ESM modules.

**Key finding from research:** The transcript JSONL has zero per-message usage/cost/model data. Cost estimation from the transcript is NOT possible. The stdin snapshot is the only data source available to the plugin. This validates our current approach but means we should be more honest about the `~` prefix meaning "lower bound."

**CRITICAL — check-before-change rules:**
- Do NOT modify files beyond what's listed in each task
- Use Python `pathlib.write_text()` for multi-file changes to avoid PostToolUse hook reverts
- Verify `git diff --stat` after each task matches the expected file list
- Build with `npx tsc` and test with `node --test` after every task

---

### Task 1: Burn Rate ($/hr)

Add burn rate to the cost display: `~$2.13 ($1.42/hr)`.

**Files:**
- Modify: `src/render/lines/cost.ts:18-37` (renderCostLine) and `:39-49` (renderCostSegment)
- No new files needed — sessionDuration is already on RenderContext via `ctx.sessionDuration`

**Step 1: Parse session duration to minutes in cost.ts**

Add a helper to convert the `sessionDuration` string (e.g., `"5m"`, `"1h 23m"`, `"<1m"`) back to minutes:

```typescript
function parseDurationMinutes(duration: string): number | null {
  if (!duration || duration === '<1m') return null;

  const hourMatch = duration.match(/(\d+)h/);
  const minMatch = duration.match(/(\d+)m/);

  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const mins = minMatch ? parseInt(minMatch[1], 10) : 0;
  const total = hours * 60 + mins;

  return total > 0 ? total : null;
}
```

**Step 2: Add burn rate to renderCostLine**

After the `costStr` line, calculate and append burn rate:

```typescript
  const durationMins = parseDurationMinutes(ctx.sessionDuration);
  const burnRate = durationMins && durationMins >= 1 && data.totalCost > 0
    ? data.totalCost / (durationMins / 60)
    : null;
  const burnStr = burnRate ? ` ${dim(`(${formatCost(burnRate)}/hr)`)}` : '';
  let result = `${dim('Cost')} ${color}~${costStr}${RESET}${burnStr}`;
```

**Step 3: Add burn rate to renderCostSegment**

```typescript
  const durationMins = parseDurationMinutes(ctx.sessionDuration);
  const burnRate = durationMins && durationMins >= 1 && data.totalCost > 0
    ? data.totalCost / (durationMins / 60)
    : null;
  const burnStr = burnRate ? dim(` ${formatCost(burnRate)}/hr`) : '';
  return `${color}~${formatCost(data.totalCost)}${RESET}${burnStr}`;
```

**Step 4: Build and test**

Run: `npx tsc && node --test tests/render.test.js tests/config.test.js`
Expected: Zero TS errors, all existing tests pass.

**Step 5: Commit**

```bash
git add src/render/lines/cost.ts
git commit -m "feat: add burn rate ($/hr) to cost display"
```

---

### Task 2: Native rate_limits from stdin (v2.1.80+)

ccstatusline discovered that Claude Code v2.1.80+ sends `rate_limits` directly in stdin JSON. This eliminates the OAuth API call entirely.

**Files:**
- Modify: `src/types.ts:5-24` — add `rate_limits` to `StdinData`
- Modify: `src/index.ts:66-74` — prefer stdin rate_limits over API call
- Modify: `src/usage-api.ts` — no changes needed (fallback path stays)

**Step 1: Add rate_limits to StdinData**

In `src/types.ts`, add after the `context_window` block:

```typescript
  rate_limits?: {
    five_hour?: {
      used_percentage?: number;
      resets_at?: string;
    };
    seven_day?: {
      used_percentage?: number;
      resets_at?: string;
    };
  };
```

**Step 2: Parse native rate limits in index.ts**

In `src/index.ts`, before the `Promise.all` block, add a function to convert stdin rate_limits to UsageData:

```typescript
function parseNativeRateLimits(stdin: StdinData, planName: string | null): UsageData | null {
  const rl = stdin.rate_limits;
  if (!rl?.five_hour && !rl?.seven_day) return null;

  const fiveHour = typeof rl.five_hour?.used_percentage === 'number'
    ? Math.round(Math.max(0, Math.min(100, rl.five_hour.used_percentage)))
    : null;
  const sevenDay = typeof rl.seven_day?.used_percentage === 'number'
    ? Math.round(Math.max(0, Math.min(100, rl.seven_day.used_percentage)))
    : null;
  const fiveHourResetAt = rl.five_hour?.resets_at ? new Date(rl.five_hour.resets_at) : null;
  const sevenDayResetAt = rl.seven_day?.resets_at ? new Date(rl.seven_day.resets_at) : null;

  // Validate dates
  if (fiveHourResetAt && isNaN(fiveHourResetAt.getTime())) return null;

  return { planName, fiveHour, sevenDay, fiveHourResetAt, sevenDayResetAt };
}
```

**Step 3: Modify the usage data resolution in the Promise.all**

Replace the `getUsage` call in the `Promise.all` with logic that checks stdin first:

```typescript
      config.display.showUsage !== false
        ? (async () => {
            // Prefer native rate_limits from stdin (Claude Code v2.1.80+)
            const native = parseNativeRateLimits(stdin, null);
            if (native) return native;
            // Fall back to OAuth API for older Claude Code versions
            return deps.getUsage({
              ttls: {
                cacheTtlMs: config.usage.cacheTtlSeconds * 1000,
                failureCacheTtlMs: config.usage.failureCacheTtlSeconds * 1000,
              },
            });
          })()
        : Promise.resolve(null),
```

Note: The `planName` for native path will be null initially. The OAuth path already resolves planName from credentials. For native, we can detect it from the stdin model or credentials file — but for v1, null planName (which hides the plan badge) is acceptable since the rate limit data itself is shown.

**Step 4: Build and test**

Run: `npx tsc && node --test tests/render.test.js tests/config.test.js`
Expected: Zero TS errors, all existing tests pass.

**Step 5: Smoke test**

Test with a stdin payload that includes rate_limits:

```bash
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000},"rate_limits":{"five_hour":{"used_percentage":25,"resets_at":"2026-03-23T06:00:00Z"},"seven_day":{"used_percentage":10}},"cwd":"/tmp","transcript_path":""}' | node dist/index.js
```

Expected: Usage line shows 25% / 10% WITHOUT making an API call.

**Step 6: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "feat: use native rate_limits from stdin (Claude Code v2.1.80+), fall back to OAuth API"
```

---

### Task 3: Lines Changed

Show git diff line counts: `+150 -42`.

**Files:**
- Modify: `src/git.ts` — add `linesAdded`/`linesRemoved` to `GitStatus`
- Modify: `src/render/lines/project.ts` — display line counts
- Modify: `src/render/session-line.ts` — display in compact mode
- Modify: `src/config.ts` — add `display.showLinesChanged` option

**Step 1: Add line counts to git.ts**

Add to `GitStatus` interface:

```typescript
  linesAdded?: number;
  linesRemoved?: number;
```

In `getGitStatus()`, after the ahead/behind block and before the return, add:

```typescript
    // Get lines changed (insertions/deletions)
    let linesAdded: number | undefined;
    let linesRemoved: number | undefined;
    try {
      const { stdout: diffOut } = await execFileAsync(
        'git',
        ['diff', '--shortstat', 'HEAD'],
        { cwd, timeout: 1000, encoding: 'utf8' }
      );
      const insertMatch = diffOut.match(/(\d+) insertion/);
      const deleteMatch = diffOut.match(/(\d+) deletion/);
      if (insertMatch) linesAdded = parseInt(insertMatch[1], 10);
      if (deleteMatch) linesRemoved = parseInt(deleteMatch[1], 10);
    } catch {
      // No diff or error, keep undefined
    }

    return { branch, isDirty, ahead, behind, fileStats, linesAdded, linesRemoved };
```

**Step 2: Add config option**

In `src/config.ts`, add `showLinesChanged: boolean` to display interface (default `true`), DEFAULT_CONFIG, and mergeConfig validation (same pattern as other booleans).

**Step 3: Display in project.ts (expanded)**

After the git status block, before speed:

```typescript
  if ((display?.showLinesChanged ?? true) && ctx.gitStatus) {
    const { linesAdded, linesRemoved } = ctx.gitStatus;
    if (linesAdded || linesRemoved) {
      const parts: string[] = [];
      if (linesAdded) parts.push(green(`+${linesAdded}`));
      if (linesRemoved) parts.push(red(`-${linesRemoved}`));
      // append to git part or as separate segment
    }
  }
```

**Step 4: Display in session-line.ts (compact)**

Same pattern, after git status section.

**Step 5: Build and test**

Run: `npx tsc && node --test tests/git.test.js tests/render.test.js tests/config.test.js`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/git.ts src/config.ts src/render/lines/project.ts src/render/session-line.ts
git commit -m "feat: show lines changed (+150 -42) from git diff"
```

---

### Task 4: Compaction State Machine

Upgrade from binary `⚡ Compacted` to 3 states: `⚠ ~85%` → `⚡ Compacted` → (clears).

**Files:**
- Modify: `src/compaction-detector.ts` — add `approaching` state
- Modify: `src/render/lines/identity.ts` — render approaching warning
- Modify: `src/render/session-line.ts` — same for compact mode

**Step 1: Add approaching state to CompactionEvent**

In `src/compaction-detector.ts`, update the `CompactionEvent` interface:

```typescript
export interface CompactionEvent {
  state: 'approaching' | 'compacted';
  delta?: number;  // percentage points dropped (only for compacted state)
  age: number;
}
```

**Step 2: Detect approaching state**

In `detectCompaction()`, when `currentPercent >= 85` and no recent compaction, return `{ state: 'approaching', age: 0 }`.

When a drop >= threshold is detected, return `{ state: 'compacted', delta: drop, age: 0 }`.

**Step 3: Update renders**

In identity.ts and session-line.ts:

```typescript
  const compactStr = ctx.compactionEvent
    ? ctx.compactionEvent.state === 'compacted'
      ? ` ${warning(ascii ? '! Compacted' : '⚡ Compacted', colors)}`
      : ` ${warning(ascii ? '! ~85%' : '⚠ ~85%', colors)}`
    : '';
```

**Step 4: Build and test**

Run: `npx tsc && node --test tests/render.test.js`
Expected: All pass.

**Step 5: Commit**

```bash
git add src/compaction-detector.ts src/render/lines/identity.ts src/render/session-line.ts
git commit -m "feat: compaction state machine (approaching + compacted states)"
```

---

### Task 5: Input + Output Speed Separately

Replace single output speed with split display: `in: 45.2 tok/s out: 31.1 tok/s`.

**Files:**
- Modify: `src/speed-tracker.ts` — track input and output separately
- Modify: `src/types.ts` or create a return type
- Modify: `src/render/lines/project.ts` — display split speed
- Modify: `src/render/session-line.ts` — display in compact mode

**Step 1: Update speed tracker to return split speeds**

Change `getOutputSpeed` to `getTokenSpeed` returning `{ input: number | null, output: number | null }`:

```typescript
export interface TokenSpeed {
  input: number | null;
  output: number | null;
}
```

Update the cache to store both `inputTokens` and `outputTokens`. Calculate deltas separately.

**Step 2: Update renders**

Replace `out: 42.1 tok/s` with `in: 45.2 out: 31.1 tok/s` when both are available, or just the one that's non-null.

**Step 3: Build and test**

Run: `npx tsc && node --test tests/speed-tracker.test.js tests/render.test.js`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/speed-tracker.ts src/render/lines/project.ts src/render/session-line.ts
git commit -m "feat: split input/output token speed display"
```

---

### Task 6: Usable Context Percentage

Show context as percentage of the usable window (80% of max, where autocompact triggers), not total window.

**Files:**
- Modify: `src/config.ts` — add `contextValue: 'usable'` option to existing `ContextValueMode`
- Modify: `src/render/lines/identity.ts` — handle 'usable' mode
- Modify: `src/render/session-line.ts` — handle 'usable' mode
- Modify: `src/render/format-helpers.ts` — add usable calculation to `formatContextValue`

**Step 1: Add 'usable' to ContextValueMode**

In `src/config.ts`, update:

```typescript
export type ContextValueMode = 'percent' | 'tokens' | 'remaining' | 'usable';
```

And the validator:

```typescript
function validateContextValue(value: unknown): value is ContextValueMode {
  return value === 'percent' || value === 'tokens' || value === 'remaining' || value === 'usable';
}
```

**Step 2: Add usable calculation to formatContextValue**

In `src/render/format-helpers.ts`, add a case:

```typescript
  if (mode === 'usable') {
    // Usable context = 80% of max (autocompact triggers at this threshold)
    const usablePercent = Math.min(100, Math.round((percent / 80) * 100));
    return `${usablePercent}%`;
  }
```

**Step 3: Build and test**

Run: `npx tsc && node --test tests/render.test.js tests/config.test.js`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/config.ts src/render/format-helpers.ts
git commit -m "feat: add 'usable' context percentage mode (% of 80% autocompact threshold)"
```

---

### Task 7: Build, Full Test, Smoke Test

**Step 1: Full build**

Run: `npx tsc`
Expected: Zero TypeScript errors.

**Step 2: Full test suite**

Run: `node --test tests/config.test.js tests/render.test.js tests/render-width.test.js tests/transcript.test.js tests/speed-tracker.test.js tests/stdin.test.js tests/terminal.test.js tests/git.test.js`
Expected: 170+ pass, 2 pre-existing failures.

**Step 3: Smoke test with full features**

```bash
echo '{"model":{"id":"us.anthropic.claude-opus-4-6-v1","display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":100000,"output_tokens":50000,"cache_creation_input_tokens":20000,"cache_read_input_tokens":500000},"context_window_size":1000000,"used_percentage":67},"rate_limits":{"five_hour":{"used_percentage":25,"resets_at":"2026-03-23T06:00:00Z"},"seven_day":{"used_percentage":10}},"cwd":"/tmp","transcript_path":""}' | node dist/index.js
```

Expected: Context 67%, usage 25%/10% from native rate_limits, cost with burn rate.
