import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';

/** Minimum percent drop to count as a compaction event */
const COMPACTION_THRESHOLD = 10;
/** How long to display the compaction indicator (ms) */
const INDICATOR_DURATION_MS = 8000;

interface CompactionCache {
  percent: number;
  timestamp: number;
  /** When compaction was last detected */
  compactedAt?: number;
  /** How many percentage points were dropped */
  compactedDelta?: number;
}

export interface CompactionEvent {
  delta: number;
  age: number;
}

export type CompactionDeps = {
  homeDir: () => string;
  now: () => number;
};

const defaultDeps: CompactionDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.compaction-cache.json');
}

function readCache(homeDir: string): CompactionCache | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content) as CompactionCache;
    if (typeof parsed.percent !== 'number' || typeof parsed.timestamp !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, cache: CompactionCache): void {
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
 * Detect context compaction events by tracking percentage drops.
 * Returns a CompactionEvent if a recent compaction was detected (within INDICATOR_DURATION_MS).
 */
export function detectCompaction(
  currentPercent: number,
  overrides: Partial<CompactionDeps> = {}
): CompactionEvent | null {
  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();
  const previous = readCache(homeDir);

  const cache: CompactionCache = { percent: currentPercent, timestamp: now };

  if (previous) {
    const drop = previous.percent - currentPercent;

    if (drop >= COMPACTION_THRESHOLD) {
      // New compaction detected
      cache.compactedAt = now;
      cache.compactedDelta = drop;
    } else if (previous.compactedAt && now - previous.compactedAt < INDICATOR_DURATION_MS) {
      // Carry forward recent compaction event
      cache.compactedAt = previous.compactedAt;
      cache.compactedDelta = previous.compactedDelta;
    }
  }

  writeCache(homeDir, cache);

  if (cache.compactedAt && cache.compactedDelta && now - cache.compactedAt < INDICATOR_DURATION_MS) {
    return { delta: cache.compactedDelta, age: now - cache.compactedAt };
  }

  return null;
}
