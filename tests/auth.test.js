import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { deriveAuthInfo, readAuthInfo, truncateUser, formatAuthSegment } from '../dist/auth.js';

const MAX_ACCOUNT = {
  oauthAccount: {
    emailAddress: 'someone.long@example.com',
    displayName: 'Some One',
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_20x',
  },
};

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('deriveAuthInfo formats claude_max with rate-limit tier', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, {});
  assert.equal(info.method, 'Claude Max 20x');
  assert.equal(info.user, 'someone.long');
});

test('deriveAuthInfo formats claude_pro without tier', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      emailAddress: 'a@b.com',
      organizationType: 'claude_pro',
      organizationRateLimitTier: 'default_claude_pro',
    },
  }, {});
  assert.equal(info.method, 'Claude Pro');
  assert.equal(info.user, 'a');
});

test('deriveAuthInfo falls back to displayName without email', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      displayName: 'Some One',
      organizationType: 'claude_enterprise',
    },
  }, {});
  assert.equal(info.method, 'Claude Enterprise');
  assert.equal(info.user, 'Some One');
});

test('deriveAuthInfo reports API Key when no oauth account but key exported', () => {
  const info = deriveAuthInfo({}, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.equal(info.method, 'API Key');
  assert.equal(info.user, null);
});

test('deriveAuthInfo gives API Key precedence over a stale oauth account', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.deepEqual(info, { method: 'API Key', user: null });
});

test('deriveAuthInfo returns nulls for missing/invalid input', () => {
  assert.deepEqual(deriveAuthInfo(null, {}), { method: null, user: null });
  assert.deepEqual(deriveAuthInfo('junk', {}), { method: null, user: null });
  assert.deepEqual(deriveAuthInfo({ oauthAccount: 42 }, {}), { method: null, user: null });
});

test('deriveAuthInfo strips ANSI sequences and control characters from values', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      emailAddress: 'evil\x1b[31m@example.com',
      organizationType: 'claude_max',
    },
  }, {});
  assert.equal(info.user, 'evil');
});

test('readAuthInfo honors CLAUDE_CONFIG_DIR and handles unreadable profiles', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-auth-test-'));
  const configDir = path.join(tempDir, 'profile');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;

    assert.deepEqual(readAuthInfo(), { method: null, user: null });

    await writeFile(`${configDir}.json`, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });

    await writeFile(`${configDir}.json`, '{invalid', 'utf8');
    assert.deepEqual(readAuthInfo(), { method: null, user: null });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    restoreEnvVar('ANTHROPIC_API_KEY', originalApiKey);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('readAuthInfo reports an API key without requiring an oauth profile', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-auth-key-test-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(tempDir, 'missing');
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    assert.deepEqual(readAuthInfo(), { method: 'API Key', user: null });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    restoreEnvVar('ANTHROPIC_API_KEY', originalApiKey);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('truncateUser truncates with ellipsis and honors 0 = full', () => {
  assert.equal(truncateUser('yukinoshita.reimu', 8), 'yukinosh…');
  assert.equal(truncateUser('short', 8), 'short');
  assert.equal(truncateUser('yukinoshita.reimu', 0), 'yukinoshita.reimu');
});

test('formatAuthSegment joins method and truncated user', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, {});
  assert.equal(
    formatAuthSegment(info, { showAuth: true, showAuthUser: true, authUserLength: 8 }),
    'Claude Max 20x · someone.…',
  );
  assert.equal(
    formatAuthSegment(info, { showAuth: true, showAuthUser: false }),
    'Claude Max 20x',
  );
  assert.equal(
    formatAuthSegment(info, { showAuth: false, showAuthUser: true, authUserLength: 0 }),
    'someone.long',
  );
  assert.equal(formatAuthSegment(info, { showAuth: false, showAuthUser: false }), null);
  assert.equal(formatAuthSegment(null, { showAuth: true, showAuthUser: true }), null);
});

// readAuthInfo caches the two DERIVED fields against claude.json's (mtime, size).
// claude.json is the user's whole CLI config -- 73 KB on a real host and growing
// with project history -- and the status line runs on every interaction, so an
// uncached parse is paid per tick. Without these tests the cache can be removed
// entirely and every behavioural test still passes, just slower: a performance
// property with no test is one that regresses silently.
test('readAuthInfo caches derived auth and serves it on an unchanged file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-cache-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;      // force the file path, not the API-key short-circuit
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud', 'hud-cache', 'auth-cache.json');
    assert.ok(fsSync.existsSync(cacheFile), 'a cache entry must be written on the first read');

    // Prove the CACHED path is taken, without depending on timestamp precision
    // (utimes cannot faithfully restore APFS sub-millisecond mtime, so a
    // rewrite-and-restore approach busts the key for the wrong reason).
    //
    // Instead make the source unreadable. statSync still succeeds -- it needs
    // only directory traversal -- so the cache key still matches, and a HIT
    // returns the stored value. A re-parse would hit EACCES on readFileSync and
    // fall through to EMPTY_AUTH_INFO. The two outcomes are unambiguous.
    fsSync.chmodSync(jsonPath, 0o000);
    let unreadable = true;
    try {
      fsSync.readFileSync(jsonPath, 'utf-8');
      unreadable = false;   // running as root, or a permissive filesystem
    } catch { /* expected */ }

    if (unreadable) {
      assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' },
        'an unchanged (mtime,size) must serve the CACHED value rather than re-parse');
    }
    fsSync.chmodSync(jsonPath, 0o600);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo re-parses when claude.json actually changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-cache-bust-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    await writeFile(jsonPath, JSON.stringify({
      oauthAccount: { emailAddress: 'other@example.com', organizationType: 'claude_pro' },
    }), 'utf8');
    const future = new Date(Date.now() + 5000);
    fsSync.utimesSync(jsonPath, future, future);

    assert.equal(readAuthInfo().user, 'other',
      'a changed file must bust the cache');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

// The cache key is (mtimeMs, size), not mtimeMs alone: two writes inside the
// same millisecond are possible, and a filesystem whose mtime granularity is
// coarser than the write rate would otherwise serve the stale entry. Hard to
// provoke by racing the clock, so the cache entry is forged directly.
test('readAuthInfo busts the cache when only the SIZE differs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-size-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');

    assert.equal(readAuthInfo().user, 'someone.long', 'seed the cache');

    // Forge an entry with the CORRECT mtime but a WRONG size, holding a value
    // that does not match the file. If size were ignored, this stale value wins.
    const cacheFile = path.join(configDir, 'plugins', 'claude-hud', 'hud-cache', 'auth-cache.json');
    const stat = fsSync.statSync(jsonPath);
    fsSync.writeFileSync(cacheFile, JSON.stringify({
      mtimeMs: stat.mtimeMs,
      size: stat.size + 1,
      method: 'STALE',
      user: 'stale-user',
    }), 'utf8');

    assert.equal(readAuthInfo().user, 'someone.long',
      'a size mismatch must bust the cache and re-parse the file');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});
