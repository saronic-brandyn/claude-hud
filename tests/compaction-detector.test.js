import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCompaction } from '../dist/compaction-detector.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeDeps() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-compact-'));
  let now = 1000000;
  return {
    deps: { homeDir: () => tmpDir, now: () => now },
    tick: (ms) => { now += ms; },
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test('detectCompaction returns null on first invocation', () => {
  const { deps, cleanup } = makeDeps();
  try {
    const result = detectCompaction(50, deps);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('detectCompaction returns approaching when >= 85%', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    detectCompaction(80, deps);
    tick(300);
    const result = detectCompaction(87, deps);
    assert.ok(result);
    assert.equal(result.state, 'approaching');
  } finally { cleanup(); }
});

test('detectCompaction returns compacted on >= 10% drop', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    detectCompaction(80, deps);
    tick(300);
    const result = detectCompaction(65, deps); // 15% drop
    assert.ok(result);
    assert.equal(result.state, 'compacted');
    assert.equal(result.delta, 15);
  } finally { cleanup(); }
});

test('detectCompaction does NOT fire on /clear (drop below 10%)', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    detectCompaction(60, deps);
    tick(300);
    const result = detectCompaction(5, deps); // 55% drop but lands below floor
    assert.equal(result, null); // NOT a compaction event
  } finally { cleanup(); }
});

test('detectCompaction indicator expires after 8s', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    detectCompaction(80, deps);
    tick(300);
    detectCompaction(65, deps); // compaction detected
    tick(8100); // past indicator duration
    const result = detectCompaction(65, deps);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('detectCompaction carries forward recent event', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    detectCompaction(80, deps);
    tick(300);
    detectCompaction(65, deps); // compacted
    tick(3000); // within 8s window
    const result = detectCompaction(66, deps); // slight change, event carries
    assert.ok(result);
    assert.equal(result.state, 'compacted');
  } finally { cleanup(); }
});
