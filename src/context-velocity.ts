import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { StdinData } from './types.js';
import { getTotalTokens } from './stdin.js';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';

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
};

const defaultDeps: VelocityDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.velocity-cache.json');
}

function readCache(homeDir: string): VelocityCache | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content) as VelocityCache;
    if (typeof parsed.totalTokens !== 'number' || typeof parsed.timestamp !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, cache: VelocityCache): void {
  try {
    const cachePath = getCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    atomicWriteFileSync(cachePath, JSON.stringify(cache));
  } catch {
    // Ignore cache write failures
  }
}

/**
 * Calculate context token velocity in tokens/minute.
 * Returns null if insufficient data or velocity below display threshold.
 */
export function getContextVelocity(stdin: StdinData, overrides: Partial<VelocityDeps> = {}): number | null {
  const totalTokens = getTotalTokens(stdin);
  if (totalTokens <= 0) return null;

  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();
  const previous = readCache(homeDir);

  // Always update cache with current state
  writeCache(homeDir, { totalTokens, timestamp: now });

  if (!previous) return null;

  const deltaTokens = totalTokens - previous.totalTokens;
  const deltaMs = now - previous.timestamp;

  // Need a reasonable window and positive growth
  if (deltaTokens <= 0 || deltaMs < MIN_WINDOW_MS || deltaMs > MAX_WINDOW_MS) {
    return null;
  }

  const tokensPerMin = (deltaTokens / deltaMs) * 60_000;
  return tokensPerMin >= MIN_DISPLAY_VELOCITY ? Math.round(tokensPerMin) : null;
}
