import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getContextVelocity } from '../dist/context-velocity.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeDeps() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-vel-'));
  let now = 1000000;
  return {
    deps: { homeDir: () => tmpDir, now: () => now },
    tick: (ms) => { now += ms; },
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function makeStdin(inputTokens) {
  return {
    context_window: {
      current_usage: { input_tokens: inputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

test('getContextVelocity returns null on first invocation', () => {
  const { deps, cleanup } = makeDeps();
  try {
    const result = getContextVelocity(makeStdin(10000), deps);
    assert.equal(result.velocity, null);
    assert.equal(result.delta, null);
  } finally { cleanup(); }
});

test('getContextVelocity returns delta when tokens increase', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    getContextVelocity(makeStdin(10000), deps);
    tick(1000); // too short for velocity
    const result = getContextVelocity(makeStdin(12000), deps);
    assert.equal(result.delta, 2000);
    // velocity null because window < 3s
    assert.equal(result.velocity, null);
  } finally { cleanup(); }
});

test('getContextVelocity calculates velocity after 3s window', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    getContextVelocity(makeStdin(10000), deps);
    tick(5000); // 5s window
    const result = getContextVelocity(makeStdin(15000), deps);
    assert.equal(result.delta, 5000);
    // 5000 tokens in 5s = 60000 tokens/min
    assert.ok(result.velocity);
    assert.ok(result.velocity >= 59000 && result.velocity <= 61000);
  } finally { cleanup(); }
});

test('getContextVelocity returns null velocity for zero-token input', () => {
  const { deps, cleanup } = makeDeps();
  try {
    const result = getContextVelocity(makeStdin(0), deps);
    assert.equal(result.velocity, null);
    assert.equal(result.delta, null);
  } finally { cleanup(); }
});

test('getContextVelocity suppresses low velocity below threshold', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    getContextVelocity(makeStdin(10000), deps);
    tick(5000);
    // Only 5 tokens in 5s = 60 tokens/min, below MIN_DISPLAY_VELOCITY (100)
    const result = getContextVelocity(makeStdin(10005), deps);
    assert.equal(result.velocity, null);
    assert.equal(result.delta, 5);
  } finally { cleanup(); }
});

test('getContextVelocity ignores stale data (>30s window)', () => {
  const { deps, tick, cleanup } = makeDeps();
  try {
    getContextVelocity(makeStdin(10000), deps);
    tick(35000); // 35s, past MAX_WINDOW_MS
    const result = getContextVelocity(makeStdin(20000), deps);
    assert.equal(result.velocity, null);
    assert.equal(result.delta, 10000);
  } finally { cleanup(); }
});
