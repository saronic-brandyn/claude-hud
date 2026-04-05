import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileCache } from '../dist/file-cache.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cache-test-'));
  // FileCache uses getHudPluginDir which returns ~/.claude/plugins/claude-hud
  // We test via direct read/write with tmpDir as homeDir
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const numCache = new FileCache({
  name: 'test-num',
  validate: (d) => d != null && typeof d === 'object' && typeof d.value === 'number',
});

test('FileCache read returns null for missing file', () => {
  const result = numCache.read(tmpDir);
  assert.equal(result, null);
});

test('FileCache write and read roundtrip', () => {
  numCache.write(tmpDir, { value: 42 });
  const result = numCache.read(tmpDir);
  assert.deepEqual(result, { value: 42 });
});

test('FileCache read returns null for invalid JSON', () => {
  const dir = path.join(tmpDir, '.claude', 'plugins', 'claude-hud');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.test-num.json'), 'not json', 'utf8');
  const result = numCache.read(tmpDir);
  assert.equal(result, null);
});

test('FileCache read returns null when validation fails', () => {
  const dir = path.join(tmpDir, '.claude', 'plugins', 'claude-hud');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.test-num.json'), '{"value":"not a number"}', 'utf8');
  const result = numCache.read(tmpDir);
  assert.equal(result, null);
});

test('FileCache session isolation creates separate files', () => {
  numCache.write(tmpDir, { value: 1 }, 'session-aaa');
  numCache.write(tmpDir, { value: 2 }, 'session-bbb');

  const a = numCache.read(tmpDir, 'session-aaa');
  const b = numCache.read(tmpDir, 'session-bbb');
  const global = numCache.read(tmpDir);

  assert.deepEqual(a, { value: 1 });
  assert.deepEqual(b, { value: 2 });
  assert.equal(global, null); // no global write was made
});

test('FileCache session ID is truncated to 12 chars in filename', () => {
  const longId = 'abcdefghijklmnopqrstuvwxyz';
  numCache.write(tmpDir, { value: 99 }, longId);

  const dir = path.join(tmpDir, '.claude', 'plugins', 'claude-hud');
  const files = fs.readdirSync(dir);
  const match = files.find(f => f.includes('abcdefghijkl') && !f.includes('abcdefghijklm'));
  assert.ok(match, `expected truncated session ID in filename, got: ${files.join(', ')}`);
});
