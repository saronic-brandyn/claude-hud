import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileCache, getCacheDir, _sweepCacheForTests } from '../dist/file-cache.js';

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

  const files = fs.readdirSync(getCacheDir(tmpDir));
  const match = files.find(f => f.includes('abcdefghijkl') && !f.includes('abcdefghijklm'));
  assert.ok(match, `expected truncated session ID in filename, got: ${files.join(', ')}`);
});

test('FileCache writes into the hud-cache subdirectory, not the plugin root', () => {
  numCache.write(tmpDir, { value: 1 }, 'sess-a');

  const pluginRoot = path.join(tmpDir, '.claude', 'plugins', 'claude-hud');
  const rootFiles = fs.readdirSync(pluginRoot).filter(f =>
    fs.statSync(path.join(pluginRoot, f)).isFile());
  assert.deepEqual(rootFiles, [],
    `cache must not litter the plugin root, found: ${rootFiles.join(', ')}`);
  assert.ok(fs.existsSync(getCacheDir(tmpDir)), 'hud-cache subdirectory should exist');
});

test('sweep removes cache entries older than the 7-day max age', () => {
  numCache.write(tmpDir, { value: 1 }, 'old-session');
  const dir = getCacheDir(tmpDir);
  const [entry] = fs.readdirSync(dir);
  const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(dir, entry), stale, stale);

  _sweepCacheForTests(tmpDir, Date.now());

  assert.deepEqual(fs.readdirSync(dir), [], 'aged-out entry should be swept');
});

test('sweep keeps cache entries inside the max age', () => {
  numCache.write(tmpDir, { value: 1 }, 'fresh-session');

  _sweepCacheForTests(tmpDir, Date.now());

  assert.equal(fs.readdirSync(getCacheDir(tmpDir)).length, 1, 'fresh entry must survive');
});

// Regression: a writer killed between writeFileSync and renameSync skips
// atomicWriteFileSync's catch-block cleanup, orphaning the .tmp. Measured on a
// real host: 87 orphaned .tmp files, all from FileCache consumers.
test('sweep removes orphaned .tmp files left by a killed writer', () => {
  numCache.write(tmpDir, { value: 1 }, 'sess');
  const dir = getCacheDir(tmpDir);
  const orphan = path.join(dir, '.velocity-cache.abc.json.9999.tmp');
  fs.writeFileSync(orphan, '{}', 'utf8');
  const stale = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(orphan, stale, stale);

  _sweepCacheForTests(tmpDir, Date.now());

  assert.ok(!fs.existsSync(orphan), 'orphaned .tmp older than 5min should be swept');
  assert.equal(fs.readdirSync(dir).length, 1, 'the real cache entry must survive');
});

test('sweep leaves a fresh .tmp alone (a concurrent write is in flight)', () => {
  const dir = getCacheDir(tmpDir);
  fs.mkdirSync(dir, { recursive: true });
  const inflight = path.join(dir, '.cost-cache.xyz.json.1234.tmp');
  fs.writeFileSync(inflight, '{}', 'utf8');

  _sweepCacheForTests(tmpDir, Date.now());

  assert.ok(fs.existsSync(inflight), 'a just-written .tmp must not be swept');
});

test('sweep enforces the 100-entry cap, evicting oldest first', () => {
  const dir = getCacheDir(tmpDir);
  fs.mkdirSync(dir, { recursive: true });
  // 105 entries, mtimes ascending so the 5 oldest are deterministic.
  for (let i = 0; i < 105; i += 1) {
    const p = path.join(dir, `entry-${String(i).padStart(3, '0')}.json`);
    fs.writeFileSync(p, '{}', 'utf8');
    const t = new Date(Date.now() - (105 - i) * 60 * 1000);
    fs.utimesSync(p, t, t);
  }

  _sweepCacheForTests(tmpDir, Date.now());

  const survivors = fs.readdirSync(dir).sort();
  assert.equal(survivors.length, 100, 'cap should be enforced');
  assert.ok(!survivors.includes('entry-000.json'), 'oldest entry should be evicted');
  assert.ok(survivors.includes('entry-104.json'), 'newest entry must survive');
});
