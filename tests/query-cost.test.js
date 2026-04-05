import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getQueryCost } from '../dist/query-cost.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeDeps(sessionId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-qcost-'));
  let now = 1000000;
  return {
    deps: { homeDir: () => tmpDir, now: () => now, sessionId },
    tick: (ms) => { now += ms; },
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test('getQueryCost returns null on first invocation (baseline)', () => {
  const { deps, cleanup } = makeDeps();
  try {
    const result = getQueryCost(1.00, deps);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('getQueryCost detects active query when cost rises', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    getQueryCost(1.00, deps); // baseline
    tick(300);
    const result = getQueryCost(1.50, deps);
    assert.ok(result);
    assert.equal(result.isActive, true);
    assert.ok(Math.abs(result.cost - 0.50) < 0.001);
  } finally { cleanup(); }
});

test('getQueryCost settles after 2s of stable cost', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    getQueryCost(1.00, deps); // baseline
    tick(300);
    getQueryCost(1.50, deps); // cost rises
    tick(2100); // past settle threshold
    const result = getQueryCost(1.50, deps);
    assert.ok(result);
    assert.equal(result.isActive, false);
    assert.ok(Math.abs(result.cost - 0.50) < 0.001);
  } finally { cleanup(); }
});

test('getQueryCost resets on cost decrease (new session)', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    getQueryCost(5.00, deps);
    tick(300);
    getQueryCost(5.50, deps);
    tick(300);
    const result = getQueryCost(0.10, deps); // cost decreased
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('getQueryCost returns null for undefined cost', () => {
  const { deps, cleanup } = makeDeps();
  try {
    const result = getQueryCost(undefined, deps);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('getQueryCost isolates by session', () => {
  const { deps: depsA, tick: tickA, cleanup: cleanupA } = makeDeps('sess-a');
  const { deps: depsB, tick: tickB, cleanup: cleanupB } = makeDeps('sess-b');
  try {
    getQueryCost(1.00, depsA);
    getQueryCost(10.00, depsB);
    tickA(300); tickB(300);
    const a = getQueryCost(1.30, depsA);
    const b = getQueryCost(10.80, depsB);
    assert.ok(a);
    assert.ok(Math.abs(a.cost - 0.30) < 0.001);
    assert.ok(b);
    assert.ok(Math.abs(b.cost - 0.80) < 0.001);
  } finally { cleanupA(); cleanupB(); }
});
