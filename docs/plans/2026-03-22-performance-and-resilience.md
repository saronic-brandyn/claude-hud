# Claude HUD Performance & Resilience Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve HUD performance, eliminate code duplication, add missing test coverage, and add ASCII fallback for Windows compatibility.

**Architecture:** The HUD runs as a fresh Node.js process every ~300ms. Each invocation reads stdin JSON, parses the transcript JSONL, fetches git status, optionally calls the usage API, and renders multi-line output to stdout. Performance gains come from parallelizing independent I/O and reducing transcript scan time. Quality gains come from deduplicating the compact/expanded renderers and adding the missing transcript test suite.

**Tech Stack:** TypeScript 5, Node.js 18+ (node:test runner), ESM modules.

**Audit corrections — these items were originally flagged but are already well-handled:**
- Timeouts: `git.ts` has 1s on all 4 `execFileAsync` calls; `usage-api.ts` has 15s configurable; `extra-cmd.ts` has 3s
- Circuit breaker: `usage-api.ts` has exponential backoff (60s→5min), `Retry-After` parsing, `lastGoodData` preservation, file-based lock
- Config validation: `config.ts` has deep field-by-field merge, color validation (named/256/hex), threshold clamping, element order dedup
- Rate-limit handling: Same as circuit breaker — full 429 handling
- Test coverage: 12 test files / 5,267 lines exist (not zero); only `transcript.test.js` is missing
- Magic numbers: Cache TTLs, thresholds, bar widths, path levels all configurable in `config.json`

---

### Task 1: Extract Shared Render Utilities (DRY)

`session-line.ts` (compact mode) copy-pastes 6 helper functions and 4 render blocks from the expanded mode files. This is ~100 lines of exact duplication that makes bugs harder to fix.

**Duplicated functions:**
- `formatTokens` — `session-line.ts:231-239` and `identity.ts:40-48`
- `formatContextValue` — `session-line.ts:241-256` and `identity.ts:50-65`
- `formatUsagePercent` — `session-line.ts:258-264` and `usage.ts:78-84`
- `formatUsageError` — `session-line.ts:266-271` and `usage.ts:86-91`
- `formatResetTime` — `session-line.ts:273-293` and `usage.ts:93-113`

**Duplicated render blocks:**
- Model bracket logic — `session-line.ts:36-44` and `project.ts:10-19`
- Project path logic — `session-line.ts:57-66` and `project.ts:22-28`
- Git status logic — `session-line.ts:68-104` and `project.ts:30-63`
- Usage rendering — `session-line.ts:143-192` and `usage.ts:7-76`

**Files:**
- Create: `src/render/format-helpers.ts`
- Modify: `src/render/session-line.ts`
- Modify: `src/render/lines/identity.ts`
- Modify: `src/render/lines/usage.ts`
- Test: `tests/render.test.js` (existing tests must still pass)

**Step 1: Run existing tests to establish baseline**

Run: `cd C:/Users/BrandynSchult/Documents/GitHub/claude-hud && npm test`
Expected: All tests PASS.

**Step 2: Create shared format-helpers.ts**

Extract the 5 duplicated helper functions into `src/render/format-helpers.ts`:

```typescript
import type { RenderContext } from '../types.js';
import { dim, getQuotaColor, RESET } from './colors.js';

export function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

export function formatContextValue(
  ctx: RenderContext,
  percent: number,
  mode: 'percent' | 'tokens' | 'remaining'
): string {
  if (mode === 'tokens') {
    const { getTotalTokens } = await import('../stdin.js');
    const totalTokens = getTotalTokens(ctx.stdin);
    const size = ctx.stdin.context_window?.context_window_size ?? 0;
    if (size > 0) {
      return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
    }
    return formatTokens(totalTokens);
  }

  if (mode === 'remaining') {
    return `${Math.max(0, 100 - percent)}%`;
  }

  return `${percent}%`;
}

export function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext['config']['colors']
): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

export function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error === 'rate-limited') return ' (syncing...)';
  if (error.startsWith('http-')) return ` (${error.slice(5)})`;
  return ` (${error})`;
}

export function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) return `${days}d ${remHours}h`;
    return `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
```

Note: `formatContextValue` uses a dynamic import for `getTotalTokens` to avoid circular dependency. The implementer should verify this works, or restructure as a static import if the dependency graph allows it. If circular, move `getTotalTokens` to `format-helpers.ts` or accept the static import since `stdin.ts` doesn't import from `render/`.

**Step 3: Update session-line.ts to use shared helpers**

Replace the 5 local function definitions at the bottom of `session-line.ts` (lines 231-293) with imports:

```typescript
import { formatTokens, formatContextValue, formatUsagePercent, formatUsageError, formatResetTime } from './format-helpers.js';
```

Delete the local `formatTokens`, `formatContextValue`, `formatUsagePercent`, `formatUsageError`, `formatResetTime` functions.

**Step 4: Update identity.ts to use shared helpers**

Replace the local `formatTokens` and `formatContextValue` (lines 40-65) with imports:

```typescript
import { formatTokens, formatContextValue } from '../format-helpers.js';
```

Delete the local copies.

**Step 5: Update usage.ts to use shared helpers**

Replace the local `formatUsagePercent`, `formatUsageError`, `formatResetTime` (lines 78-113) with imports:

```typescript
import { formatUsagePercent, formatUsageError, formatResetTime } from '../format-helpers.js';
```

Delete the local copies.

**Step 6: Run tests to verify no regressions**

Run: `npm run build && npm test`
Expected: All existing tests PASS — behavior unchanged, only code organization changed.

**Step 7: Commit**

```bash
git add src/render/format-helpers.ts src/render/session-line.ts src/render/lines/identity.ts src/render/lines/usage.ts
git commit -m "refactor: extract shared render helpers to eliminate compact/expanded duplication"
```

---

### Task 2: Parallelize Independent I/O in index.ts

Currently `index.ts:56-78` runs `parseTranscript`, `countConfigs`, `getGitStatus`, and `getUsage` sequentially. All four are independent once `loadConfig()` completes.

**Files:**
- Modify: `src/index.ts:56-78`
- Test: `tests/index.test.js`

**Step 1: Write the failing test**

Add to `tests/index.test.js`:

```javascript
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../dist/index.js';
import { DEFAULT_CONFIG } from '../dist/config.js';

test('main() runs getGitStatus and getUsage concurrently', async () => {
  const callOrder = [];
  let gitResolve, usageResolve;
  const gitPromise = new Promise((r) => { gitResolve = r; });
  const usagePromise = new Promise((r) => { usageResolve = r; });

  const mainPromise = main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { current_usage: { input_tokens: 1000 }, context_window_size: 200000 },
      cwd: '/test',
      transcript_path: '',
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => {
      callOrder.push('git-start');
      await gitPromise;
      callOrder.push('git-end');
      return null;
    },
    getUsage: async () => {
      callOrder.push('usage-start');
      await usagePromise;
      callOrder.push('usage-end');
      return null;
    },
    loadConfig: async () => DEFAULT_CONFIG,
    parseExtraCmdArg: () => null,
    runExtraCmd: async () => null,
    render: () => {},
    now: () => Date.now(),
    log: () => {},
  });

  // Wait a tick for both to start
  await new Promise((r) => setTimeout(r, 10));

  // Both should have started before either finishes
  assert.ok(callOrder.includes('git-start'), 'git should have started');
  assert.ok(callOrder.includes('usage-start'), 'usage should have started');

  gitResolve();
  usageResolve();
  await mainPromise;
});
```

**Step 2: Run test to verify it fails**

Run: `npm run build && npm test`
Expected: FAIL — with sequential execution, `usage-start` won't appear until after `git-end`.

**Step 3: Refactor index.ts to parallelize I/O**

Replace `index.ts` lines 56-78 (everything between `const stdin` check and `const ctx`) with:

```typescript
    const transcriptPath = stdin.transcript_path ?? '';
    const config = await deps.loadConfig();

    // Run independent I/O in parallel — these don't depend on each other
    const [transcript, configCounts, gitStatus, usageData] = await Promise.all([
      deps.parseTranscript(transcriptPath),
      deps.countConfigs(stdin.cwd),
      config.gitStatus.enabled
        ? deps.getGitStatus(stdin.cwd)
        : Promise.resolve(null),
      config.display.showUsage !== false
        ? deps.getUsage({
            ttls: {
              cacheTtlMs: config.usage.cacheTtlSeconds * 1000,
              failureCacheTtlMs: config.usage.failureCacheTtlSeconds * 1000,
            },
          })
        : Promise.resolve(null),
    ]);

    const { claudeMdCount, rulesCount, mcpCount, hooksCount } = configCounts;

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;
```

**Step 4: Run tests to verify they pass**

Run: `npm run build && npm test`
Expected: PASS — both the new concurrency test and all existing tests.

**Step 5: Commit**

```bash
git add src/index.ts tests/index.test.js
git commit -m "perf: parallelize git, usage, transcript, and config-count I/O in main()"
```

---

### Task 3: Add Transcript Test Suite

`transcript.ts` is 232 lines with JSONL parsing, a tool/agent state machine, task tracking, and slug/title extraction — yet it's the only module without a dedicated test file.

**Files:**
- Create: `tests/transcript.test.js`

**Step 1: Write the test file**

```javascript
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseTranscript } from '../dist/transcript.js';

function tmpJsonl(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-transcript-'));
  const file = path.join(dir, 'test.jsonl');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true }) };
}

describe('parseTranscript', () => {
  test('returns empty result for missing file', async () => {
    const result = await parseTranscript('/nonexistent/path.jsonl');
    assert.deepStrictEqual(result.tools, []);
    assert.deepStrictEqual(result.agents, []);
    assert.deepStrictEqual(result.todos, []);
    assert.strictEqual(result.sessionStart, undefined);
  });

  test('returns empty result for empty string path', async () => {
    const result = await parseTranscript('');
    assert.deepStrictEqual(result.tools, []);
  });

  test('returns empty result for empty file', async () => {
    const { file, cleanup } = tmpJsonl([]);
    try {
      const result = await parseTranscript(file);
      assert.deepStrictEqual(result.tools, []);
    } finally {
      cleanup();
    }
  });

  test('captures sessionStart from first timestamped entry', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({ timestamp: '2026-01-01T12:00:00Z', message: { content: [] } }),
      JSON.stringify({ timestamp: '2026-01-01T12:05:00Z', message: { content: [] } }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.ok(result.sessionStart instanceof Date);
      assert.strictEqual(result.sessionStart.toISOString(), '2026-01-01T12:00:00.000Z');
    } finally {
      cleanup();
    }
  });

  test('parses tool_use and tool_result pair as completed', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/foo.ts' } }] },
      }),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:01Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.tools.length, 1);
      assert.strictEqual(result.tools[0].name, 'Read');
      assert.strictEqual(result.tools[0].status, 'completed');
      assert.strictEqual(result.tools[0].target, '/foo.ts');
    } finally {
      cleanup();
    }
  });

  test('tool_use without tool_result stays running', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la /tmp' } }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.tools.length, 1);
      assert.strictEqual(result.tools[0].status, 'running');
    } finally {
      cleanup();
    }
  });

  test('tool_result with is_error marks tool as error', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: {} }] },
      }),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:01Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.tools[0].status, 'error');
    } finally {
      cleanup();
    }
  });

  test('keeps only last 20 tools', async () => {
    const lines = [];
    for (let i = 0; i < 30; i++) {
      lines.push(JSON.stringify({
        timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
        message: { content: [{ type: 'tool_use', id: `t${i}`, name: `Tool${i}`, input: {} }] },
      }));
      lines.push(JSON.stringify({
        timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
        message: { content: [{ type: 'tool_result', tool_use_id: `t${i}` }] },
      }));
    }
    const { file, cleanup } = tmpJsonl(lines);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.tools.length, 20);
      assert.strictEqual(result.tools[0].name, 'Tool10');
      assert.strictEqual(result.tools[19].name, 'Tool29');
    } finally {
      cleanup();
    }
  });

  test('parses Task tool_use as agent entry', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{
          type: 'tool_use', id: 'a1', name: 'Task',
          input: { subagent_type: 'Explore', model: 'haiku', description: 'Find auth code' },
        }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.agents.length, 1);
      assert.strictEqual(result.agents[0].type, 'Explore');
      assert.strictEqual(result.agents[0].model, 'haiku');
      assert.strictEqual(result.agents[0].description, 'Find auth code');
      assert.strictEqual(result.agents[0].status, 'running');
      // Task calls should NOT appear in tools
      assert.strictEqual(result.tools.length, 0);
    } finally {
      cleanup();
    }
  });

  test('parses TodoWrite as todo list replacement', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{
          type: 'tool_use', id: 'tw1', name: 'TodoWrite',
          input: { todos: [
            { content: 'Fix bug', status: 'in_progress' },
            { content: 'Write tests', status: 'pending' },
          ] },
        }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.todos.length, 2);
      assert.strictEqual(result.todos[0].content, 'Fix bug');
      assert.strictEqual(result.todos[0].status, 'in_progress');
    } finally {
      cleanup();
    }
  });

  test('TaskCreate adds to todo list', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{
          type: 'tool_use', id: 'tc1', name: 'TaskCreate',
          input: { subject: 'Implement feature', status: 'pending', taskId: '1' },
        }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.todos.length, 1);
      assert.strictEqual(result.todos[0].content, 'Implement feature');
      assert.strictEqual(result.todos[0].status, 'pending');
    } finally {
      cleanup();
    }
  });

  test('TaskUpdate modifies existing todo by taskId', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{
          type: 'tool_use', id: 'tc1', name: 'TaskCreate',
          input: { subject: 'Build thing', status: 'pending', taskId: '42' },
        }] },
      }),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:01Z',
        message: { content: [{
          type: 'tool_use', id: 'tu1', name: 'TaskUpdate',
          input: { taskId: '42', status: 'completed' },
        }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.todos.length, 1);
      assert.strictEqual(result.todos[0].status, 'completed');
    } finally {
      cleanup();
    }
  });

  test('skips malformed JSONL lines gracefully', async () => {
    const { file, cleanup } = tmpJsonl([
      'not valid json',
      '{"incomplete":',
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Glob', input: { pattern: '**/*.ts' } }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.tools.length, 1);
      assert.strictEqual(result.tools[0].name, 'Glob');
    } finally {
      cleanup();
    }
  });

  test('captures custom-title as sessionName', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({ type: 'custom-title', customTitle: 'My Debug Session', timestamp: '2026-01-01T00:00:00Z' }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.sessionName, 'My Debug Session');
    } finally {
      cleanup();
    }
  });

  test('captures slug as sessionName when no custom-title', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({ slug: 'fix-auth-bug', timestamp: '2026-01-01T00:00:00Z', message: { content: [] } }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.sessionName, 'fix-auth-bug');
    } finally {
      cleanup();
    }
  });

  test('custom-title takes precedence over slug', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({ slug: 'auto-slug', timestamp: '2026-01-01T00:00:00Z', message: { content: [] } }),
      JSON.stringify({ type: 'custom-title', customTitle: 'User Title', timestamp: '2026-01-01T00:00:01Z' }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.sessionName, 'User Title');
    } finally {
      cleanup();
    }
  });

  test('extractTarget returns file_path for Read/Write/Edit', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/src/index.ts' } }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.strictEqual(result.tools[0].target, '/src/index.ts');
    } finally {
      cleanup();
    }
  });

  test('extractTarget truncates long Bash commands', async () => {
    const { file, cleanup } = tmpJsonl([
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00Z',
        message: { content: [{
          type: 'tool_use', id: 't1', name: 'Bash',
          input: { command: 'find /very/long/path -name "*.ts" -exec grep -l "pattern" {} +' },
        }] },
      }),
    ]);
    try {
      const result = await parseTranscript(file);
      assert.ok(result.tools[0].target.length <= 33); // 30 + '...'
      assert.ok(result.tools[0].target.endsWith('...'));
    } finally {
      cleanup();
    }
  });
});
```

**Step 2: Run tests**

Run: `npm run build && npm test`
Expected: All PASS.

**Step 3: Commit**

```bash
git add tests/transcript.test.js
git commit -m "test: add transcript parser test suite (17 tests)"
```

---

### Task 4: Transcript Tail-Read Optimization

For large sessions (>512KB JSONL), reading every line from the start wastes time. Since the HUD only shows the last 20 tools and 10 agents, reading the tail is sufficient for activity. Only `sessionStart` needs the first line.

**Files:**
- Modify: `src/transcript.ts`
- Modify: `tests/transcript.test.js` (add perf test)

**Step 1: Add performance test**

Append to `tests/transcript.test.js`:

```javascript
test('handles large transcript within 200ms', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-transcript-'));
  const file = path.join(dir, 'large.jsonl');
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    lines.push(JSON.stringify({
      timestamp: `2026-01-01T00:00:00Z`,
      message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `/file${i}.ts` } }] },
    }));
    lines.push(JSON.stringify({
      timestamp: `2026-01-01T00:00:00Z`,
      message: { content: [{ type: 'tool_result', tool_use_id: `t${i}` }] },
    }));
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  try {
    const start = Date.now();
    const result = await parseTranscript(file);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `took ${elapsed}ms, expected <200ms`);
    assert.strictEqual(result.tools.length, 20); // last 20 only
    assert.ok(result.sessionStart instanceof Date);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
```

**Step 2: Run test to establish baseline**

Run: `npm run build && npm test`
Expected: PASS (current streaming approach handles 10k lines). This establishes a regression gate.

**Step 3: Add tail-read optimization**

Add constants at the top of `src/transcript.ts`:

```typescript
const TAIL_THRESHOLD_BYTES = 512 * 1024;
const TAIL_READ_BYTES = 128 * 1024;
```

Add helper functions at the bottom:

```typescript
async function readFirstLine(filePath: string): Promise<string | null> {
  const stream = fs.createReadStream(filePath, { end: 4096 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    rl.close();
    stream.destroy();
    return line;
  }
  return null;
}

function readTailBytes(filePath: string, bytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const start = Math.max(0, stat.size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, stat.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
```

In `parseTranscript()`, wrap the existing `try` block (lines 42-66) to check file size first:

```typescript
  try {
    const stat = fs.statSync(transcriptPath);

    if (stat.size > TAIL_THRESHOLD_BYTES) {
      // Large file: first line for sessionStart, tail for recent activity
      const firstLine = await readFirstLine(transcriptPath);
      if (firstLine) {
        try {
          const entry = JSON.parse(firstLine) as TranscriptLine;
          if (entry.timestamp) {
            result.sessionStart = new Date(entry.timestamp);
          }
          if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
            customTitle = entry.customTitle;
          } else if (typeof entry.slug === 'string') {
            latestSlug = entry.slug;
          }
        } catch { /* skip malformed first line */ }
      }

      const tailContent = readTailBytes(transcriptPath, TAIL_READ_BYTES);
      const tailLines = tailContent.split('\n');
      // First line of tail chunk may be partial — skip it
      for (let i = 1; i < tailLines.length; i++) {
        const line = tailLines[i].trim();
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as TranscriptLine;
          if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
            customTitle = entry.customTitle;
          } else if (typeof entry.slug === 'string') {
            latestSlug = entry.slug;
          }
          processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, result);
        } catch { /* skip malformed */ }
      }
    } else {
      // Small file: stream normally (existing behavior)
      const fileStream = fs.createReadStream(transcriptPath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of rl) {
        // ... existing loop body unchanged ...
      }
    }
  } catch {
    // Return partial results on error
  }
```

**Step 4: Run tests**

Run: `npm run build && npm test`
Expected: All PASS including perf test.

**Step 5: Commit**

```bash
git add src/transcript.ts tests/transcript.test.js
git commit -m "perf: tail-read optimization for large transcripts (>512KB)"
```

---

### Task 5: Atomic Speed Cache Writes

`speed-tracker.ts:50` uses `writeFileSync` with no locking. Unlike `usage-api.ts` (which has a file lock mechanism), concurrent 300ms HUD invocations can produce corrupt JSON in the speed cache.

**Files:**
- Create: `src/atomic-write.ts`
- Modify: `src/speed-tracker.ts`
- Test: existing `tests/speed-tracker.test.js`

**Step 1: Create atomic write utility**

```typescript
// src/atomic-write.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Write a file atomically via write-to-temp + rename.
 * Prevents corruption when multiple HUD processes write concurrently.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    fs.writeFileSync(tmpPath, data, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Clean up temp file on failure, fall back to direct write
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    fs.writeFileSync(filePath, data, 'utf8');
  }
}
```

**Step 2: Use in speed-tracker.ts**

Add import:
```typescript
import { atomicWriteFileSync } from './atomic-write.js';
```

Replace `speed-tracker.ts:50`:
```typescript
// Before:
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
// After:
    atomicWriteFileSync(cachePath, JSON.stringify(cache));
```

**Step 3: Run tests**

Run: `npm run build && npm test`
Expected: All PASS.

**Step 4: Commit**

```bash
git add src/atomic-write.ts src/speed-tracker.ts
git commit -m "fix: atomic speed cache writes to prevent corruption from concurrent invocations"
```

---

### Task 6: ASCII Fallback Mode for Windows Terminals

Some Windows terminal fonts can't render `█░◐✓✗▸⏱️✘`. Add a config option to switch to ASCII equivalents.

**Files:**
- Modify: `src/config.ts` (add `asciiMode` to display config)
- Modify: `src/render/colors.ts` (ASCII bar functions)
- Modify: `src/render/tools-line.ts`
- Modify: `src/render/agents-line.ts`
- Modify: `src/render/todos-line.ts`
- Modify: `src/render/session-line.ts`
- Modify: `src/render/lines/project.ts`
- Test: `tests/render.test.js` (add ASCII mode tests)

**Step 1: Add asciiMode to config**

In `src/config.ts`, add to `HudConfig.display` interface (after `customLine: string`):
```typescript
    asciiMode: boolean;
```

Add default in `DEFAULT_CONFIG.display` (after `customLine: ''`):
```typescript
    asciiMode: false,
```

Add validation in `mergeConfig` display block (after the `customLine` validation):
```typescript
    asciiMode: typeof migrated.display?.asciiMode === 'boolean'
      ? migrated.display.asciiMode
      : DEFAULT_CONFIG.display.asciiMode,
```

**Step 2: Add ASCII bar functions to colors.ts**

Append to `src/render/colors.ts`:

```typescript
export function coloredBarAscii(percent: number, width: number = 10, colors?: Partial<HudColorOverrides>): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getContextColor(safePercent, colors);
  return `${color}${'#'.repeat(filled)}${DIM}${'-'.repeat(empty)}${RESET}`;
}

export function quotaBarAscii(percent: number, width: number = 10, colors?: Partial<HudColorOverrides>): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getQuotaColor(safePercent, colors);
  return `${color}${'#'.repeat(filled)}${DIM}${'-'.repeat(empty)}${RESET}`;
}
```

**Step 3: Update render files to respect asciiMode**

In each render file, check `ctx.config.display.asciiMode` and swap symbols:

| File | Unicode | ASCII |
|------|---------|-------|
| `tools-line.ts:18` | `◐` (running) | `~` |
| `tools-line.ts:32` | `✓` (completed) | `+` |
| `agents-line.ts:28` | `◐` / `✓` | `~` / `+` |
| `todos-line.ts:17,25` | `✓` / `▸` | `+` / `>` |
| `session-line.ts:96` | `✘` (deleted) | `x` |
| `session-line.ts:203`, `project.ts:89` | `⏱️` | `T:` |
| `session-line.ts:28,147,169-182`, `identity.ts:25`, `usage.ts:50-68` | `coloredBar`/`quotaBar` | `coloredBarAscii`/`quotaBarAscii` |

Pattern for each file — define symbols at the top of the function using config:

```typescript
const ascii = ctx.config?.display?.asciiMode ?? false;
const RUNNING = ascii ? '~' : '◐';
const DONE = ascii ? '+' : '✓';
```

For bars, select the function:

```typescript
const barFn = ascii ? coloredBarAscii : coloredBar;
const quotaFn = ascii ? quotaBarAscii : quotaBar;
```

**Step 4: Add test**

Add to `tests/render.test.js`:

```javascript
test('renders ASCII symbols when asciiMode is true', () => {
  // Build a config with asciiMode: true, call renderToolsLine with a running tool
  // Assert output contains ~ instead of ◐ and + instead of ✓
});
```

**Step 5: Run tests**

Run: `npm run build && npm test`
Expected: All PASS.

**Step 6: Commit**

```bash
git add src/config.ts src/render/colors.ts src/render/tools-line.ts src/render/agents-line.ts src/render/todos-line.ts src/render/session-line.ts src/render/lines/project.ts src/render/lines/identity.ts src/render/lines/usage.ts tests/render.test.js
git commit -m "feat: add asciiMode config for Windows terminal font compatibility"
```

---

### Task 7: Build, Test, and Smoke Test

**Step 1: Full build**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 3: Manual smoke test**

```bash
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000},"cwd":"/tmp","transcript_path":""}' | node dist/index.js
```

Expected: HUD renders correctly with no errors.

**Step 4: Verify dist/ status**

```bash
git status
```

`dist/` should be gitignored (CI builds it). If tracked, add to commit.
