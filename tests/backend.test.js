import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBackendProfile, backendProfileLabel } from '../dist/backend.js';

// Env fixtures mirror what each launcher leaves visible to the statusline
// SUBPROCESS — critically, ANTHROPIC_API_KEY / AWS_BEARER_TOKEN_BEDROCK are
// SCRUBBED (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1), so they are absent here on
// purpose. Detection must not depend on them.
const GOV_ENV = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-gov-west-1' };
const BEDROCK_ENV = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-2' };
const CLEAN_ENV = {}; // subscription / workspace: no bedrock, creds scrubbed

const GOV_STDIN = { model: { id: 'us-gov.anthropic.claude-opus-4-8', display_name: 'Opus 4.8' } };
const BEDROCK_STDIN = { model: { id: 'us.anthropic.claude-opus-4-8', display_name: 'Opus 4.8' } };
const FIRSTPARTY_STDIN = { model: { id: 'claude-sonnet-5', display_name: 'Sonnet 5' } };

// --- the four profiles, detected from realistic scrubbed env ------------------

test('detectBackendProfile: claude-gov from gov region', () => {
  assert.equal(detectBackendProfile(GOV_STDIN, { env: GOV_ENV }), 'claude-gov');
});

test('detectBackendProfile: claude-bedrock from commercial region', () => {
  assert.equal(detectBackendProfile(BEDROCK_STDIN, { env: BEDROCK_ENV }), 'claude-bedrock');
});

test('detectBackendProfile: claude (subscription) when OAuth subscription present', () => {
  assert.equal(
    detectBackendProfile(FIRSTPARTY_STDIN, { env: CLEAN_ENV, hasSubscription: true }),
    'claude',
  );
});

test('detectBackendProfile: claude-ws when a visible API key and no subscription', () => {
  // Positive API-key signal (rare — usually scrubbed — but authoritative when present).
  assert.equal(
    detectBackendProfile(FIRSTPARTY_STDIN, { env: CLEAN_ENV, hasSubscription: false, hasApiKey: true }),
    'claude-ws',
  );
});

test('detectBackendProfile: unknown when non-bedrock with neither subscription nor visible key', () => {
  // Ambiguous — could be a subscription session whose usage API hasn't loaded,
  // or a scrubbed workspace key. Must NOT guess claude-ws; return unknown so the
  // caller falls back to the established plan/provider label.
  assert.equal(
    detectBackendProfile(FIRSTPARTY_STDIN, { env: CLEAN_ENV, hasSubscription: false }),
    'unknown',
  );
});

// --- robustness: the reason we don't trust credentials ------------------------

test('detectBackendProfile: gov detected even with credentials scrubbed (no bearer token in env)', () => {
  // Exactly the captured real env: USE_BEDROCK=1, gov region, NO AWS_BEARER_TOKEN_BEDROCK.
  assert.equal(detectBackendProfile(GOV_STDIN, { env: GOV_ENV, hasSubscription: false }), 'claude-gov');
});

test('detectBackendProfile: gov detected from us-gov. model id even if region is absent', () => {
  // Defense in depth — stdin model id is never scrubbed, so it backs up AWS_REGION.
  assert.equal(
    detectBackendProfile(GOV_STDIN, { env: { CLAUDE_CODE_USE_BEDROCK: '1' } }),
    'claude-gov',
  );
});

test('detectBackendProfile: bedrock detected from model id even without the USE_BEDROCK flag', () => {
  assert.equal(detectBackendProfile(BEDROCK_STDIN, { env: {} }), 'claude-bedrock');
});

// --- explicit override wins ---------------------------------------------------

test('detectBackendProfile: CLAUDE_HUD_PROFILE override wins over inferred signals', () => {
  // Even with gov signals, an explicit override is honored.
  assert.equal(
    detectBackendProfile(GOV_STDIN, { env: { ...GOV_ENV, CLAUDE_HUD_PROFILE: 'claude-ws' } }),
    'claude-ws',
  );
});

test('detectBackendProfile: unknown/garbage CLAUDE_HUD_PROFILE is ignored, falls through to inference', () => {
  assert.equal(
    detectBackendProfile(GOV_STDIN, { env: { ...GOV_ENV, CLAUDE_HUD_PROFILE: 'nonsense' } }),
    'claude-gov',
  );
});

// --- unknown fallback ---------------------------------------------------------

test('detectBackendProfile: unknown when nothing identifies the backend', () => {
  // Not bedrock, no subscription signal, no visible key, no model id → unknown,
  // so the render layer falls back to its established plan/provider label.
  assert.equal(detectBackendProfile({}, { env: {} }), 'unknown');
});

// --- labels are the verbatim profile name ------------------------------------

test('backendProfileLabel: returns the verbatim launcher name', () => {
  assert.equal(backendProfileLabel('claude'), 'claude');
  assert.equal(backendProfileLabel('claude-ws'), 'claude-ws');
  assert.equal(backendProfileLabel('claude-bedrock'), 'claude-bedrock');
  assert.equal(backendProfileLabel('claude-gov'), 'claude-gov');
});

test('backendProfileLabel: unknown yields null so callers fall back', () => {
  assert.equal(backendProfileLabel('unknown'), null);
});
