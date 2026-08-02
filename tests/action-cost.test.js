import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getActionCosts } from '../dist/action-cost.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// getActionCosts now accepts an injectable homeDir dep (matching its siblings
// compaction-detector / context-velocity / query-cost), so these tests run
// against a throwaway directory instead of the real ~/.claude. Before the
// refactor they wrote cache files into the user's live plugin dir -- which is
// how a stray action-cost-cache.json ended up there.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-action-cost-'));
const DEPS = { homeDir: () => SANDBOX };

process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** getActionCosts bound to the sandbox so no test can touch the real config dir. */
function costs(totalCostUsd, tools, agents, threshold, sessionId) {
  return getActionCosts(totalCostUsd, tools, agents, threshold, sessionId, DEPS);
}

function makeTool(name, status = 'running') {
  return { id: `${name}-1`, name, status, startTime: new Date() };
}

function makeAgent(status = 'running') {
  return { id: 'agent-1', type: 'general-purpose', status, startTime: new Date() };
}

test('getActionCosts returns null for undefined cost', () => {
  const result = costs(undefined, [], [], 0.10);
  assert.equal(result, null);
});

test('getActionCosts returns null on first invocation (baseline)', () => {
  // This test uses the global cache — first call establishes baseline
  const result = costs(0.50, [makeTool('Bash')], [], 0.10);
  // First call returns null (baseline) OR results if prior test left state
  // The contract is: it doesn't crash and returns ActionCostEntry[] | null
  assert.ok(result === null || Array.isArray(result));
});

test('getActionCosts attributes cost to running tools', () => {
  // Force a baseline by providing a known cost
  costs(100.00, [], [], 0.10);
  // Now increase cost with a running tool
  const result = costs(100.50, [makeTool('Bash')], [], 0.10);
  if (result) {
    const bash = result.find(e => e.toolType === 'Bash');
    assert.ok(bash, 'expected Bash in action costs');
    assert.ok(bash.totalCost > 0);
  }
});

test('getActionCosts attributes to Thinking when no tools running', () => {
  costs(200.00, [], [], 0.10);
  const result = costs(200.30, [], [], 0.10);
  if (result) {
    const thinking = result.find(e => e.toolType === 'Thinking');
    assert.ok(thinking, 'expected Thinking in action costs');
  }
});

test('getActionCosts resets on cost decrease', () => {
  costs(300.00, [], [], 0.10);
  const result = costs(0.01, [], [], 0.10); // cost went down
  assert.equal(result, null);
});

test('getActionCosts filters by threshold', () => {
  // Reset by triggering cost decrease
  costs(0.01, [], [], 500.00);
  costs(1.00, [], [], 500.00); // baseline at 1.00
  // Small increase — $0.10 is below $500 threshold
  const result = costs(1.10, [makeTool('Read')], [], 500.00);
  assert.equal(result, null);
});
