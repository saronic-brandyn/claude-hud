import * as os from 'node:os';
import type { StdinData } from './types.js';
import { getTotalTokens } from './stdin.js';
import { FileCache } from './file-cache.js';

/** Minimum window to calculate velocity (avoid spikes from rapid renders) */
const MIN_WINDOW_MS = 3000;
/** Maximum window before data is stale */
const MAX_WINDOW_MS = 30_000;
/** Minimum velocity to display (tokens/min) — suppresses noise during idle */
const MIN_DISPLAY_VELOCITY = 100;

interface VelocityCache {
  totalTokens: number;
  timestamp: number;
}

export type VelocityDeps = {
  homeDir: () => string;
  now: () => number;
  sessionId?: string;
};

const defaultDeps: VelocityDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

const cache = new FileCache<VelocityCache>({
  name: 'velocity-cache',
  validate: (d): d is VelocityCache =>
    d != null && typeof d === 'object'
    && typeof (d as VelocityCache).totalTokens === 'number'
    && typeof (d as VelocityCache).timestamp === 'number',
});

/**
 * Calculate context token velocity in tokens/minute.
 * Returns null if insufficient data or velocity below display threshold.
 */
export interface VelocityResult {
  velocity: number | null;
  delta: number | null;
}

export function getContextVelocity(stdin: StdinData, overrides: Partial<VelocityDeps> = {}): VelocityResult {
  const totalTokens = getTotalTokens(stdin);
  if (totalTokens <= 0) return { velocity: null, delta: null };

  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();
  const sid = deps.sessionId;
  const previous = cache.read(homeDir, sid);

  // Always update cache with current state
  cache.write(homeDir, { totalTokens, timestamp: now }, sid);

  if (!previous) return { velocity: null, delta: null };

  const deltaTokens = totalTokens - previous.totalTokens;
  const deltaMs = now - previous.timestamp;

  const delta = deltaTokens > 0 ? deltaTokens : null;

  // Need a reasonable window and positive growth for velocity
  if (deltaTokens <= 0 || deltaMs < MIN_WINDOW_MS || deltaMs > MAX_WINDOW_MS) {
    return { velocity: null, delta };
  }

  const tokensPerMin = (deltaTokens / deltaMs) * 60_000;
  const velocity = tokensPerMin >= MIN_DISPLAY_VELOCITY ? Math.round(tokensPerMin) : null;
  return { velocity, delta };
}
