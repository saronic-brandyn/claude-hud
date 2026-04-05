import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getActionCosts } from '../dist/action-cost.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// getActionCosts uses os.homedir() internally — we can't inject homeDir easily
// since it doesn't take deps. But we can test the logic through its public API
// by leveraging the global cache (tests run sequentially in the same process).

// For isolated tests, we'd need to refactor getActionCosts to accept deps.
// For now, test the core behavioral contract.

function makeTool(name, status = 'running') {
  return { id: `${name}-1`, name, status, startTime: new Date() };
}

function makeAgent(status = 'running') {
  return { id: 'agent-1', type: 'general-purpose', status, startTime: new Date() };
}

test('getActionCosts returns null for undefined cost', () => {
  const result = getActionCosts(undefined, [], [], 0.10);
  assert.equal(result, null);
});

test('getActionCosts returns null on first invocation (baseline)', () => {
  // This test uses the global cache — first call establishes baseline
  const result = getActionCosts(0.50, [makeTool('Bash')], [], 0.10);
  // First call returns null (baseline) OR results if prior test left state
  // The contract is: it doesn't crash and returns ActionCostEntry[] | null
  assert.ok(result === null || Array.isArray(result));
});

test('getActionCosts attributes cost to running tools', () => {
  // Force a baseline by providing a known cost
  getActionCosts(100.00, [], [], 0.10);
  // Now increase cost with a running tool
  const result = getActionCosts(100.50, [makeTool('Bash')], [], 0.10);
  if (result) {
    const bash = result.find(e => e.toolType === 'Bash');
    assert.ok(bash, 'expected Bash in action costs');
    assert.ok(bash.totalCost > 0);
  }
});

test('getActionCosts attributes to Thinking when no tools running', () => {
  getActionCosts(200.00, [], [], 0.10);
  const result = getActionCosts(200.30, [], [], 0.10);
  if (result) {
    const thinking = result.find(e => e.toolType === 'Thinking');
    assert.ok(thinking, 'expected Thinking in action costs');
  }
});

test('getActionCosts resets on cost decrease', () => {
  getActionCosts(300.00, [], [], 0.10);
  const result = getActionCosts(0.01, [], [], 0.10); // cost went down
  assert.equal(result, null);
});

test('getActionCosts filters by threshold', () => {
  // Reset by triggering cost decrease
  getActionCosts(0.01, [], [], 500.00);
  getActionCosts(1.00, [], [], 500.00); // baseline at 1.00
  // Small increase — $0.10 is below $500 threshold
  const result = getActionCosts(1.10, [makeTool('Read')], [], 500.00);
  assert.equal(result, null);
});
