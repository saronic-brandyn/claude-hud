import * as os from 'node:os';
import { FileCache } from './file-cache.js';

/** Context percent threshold for approaching warning */
const APPROACHING_THRESHOLD = 85;
/** Minimum percent drop to count as a compaction event */
const COMPACTION_THRESHOLD = 10;
/** If context drops below this floor, it's a /clear, not compaction */
const CLEAR_FLOOR_PERCENT = 10;
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
  state: 'approaching' | 'compacted';
  delta?: number;
  age: number;
}

export type CompactionDeps = {
  homeDir: () => string;
  now: () => number;
  sessionId?: string;
};

const defaultDeps: CompactionDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

const cache = new FileCache<CompactionCache>({
  name: 'compaction-cache',
  validate: (d): d is CompactionCache =>
    d != null && typeof d === 'object'
    && typeof (d as CompactionCache).percent === 'number'
    && typeof (d as CompactionCache).timestamp === 'number',
});

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
  const sid = deps.sessionId;
  const previous = cache.read(homeDir, sid);

  const entry: CompactionCache = { percent: currentPercent, timestamp: now };

  if (previous) {
    const drop = previous.percent - currentPercent;

    // If context drops below the floor, it's a /clear or new session — not compaction
    if (drop >= COMPACTION_THRESHOLD && currentPercent >= CLEAR_FLOOR_PERCENT) {
      entry.compactedAt = now;
      entry.compactedDelta = drop;
    } else if (previous.compactedAt && now - previous.compactedAt < INDICATOR_DURATION_MS) {
      // Carry forward recent compaction event
      entry.compactedAt = previous.compactedAt;
      entry.compactedDelta = previous.compactedDelta;
    }
  }

  cache.write(homeDir, entry, sid);

  if (entry.compactedAt && entry.compactedDelta && now - entry.compactedAt < INDICATOR_DURATION_MS) {
    return { state: 'compacted', delta: entry.compactedDelta, age: now - entry.compactedAt };
  }

  // Approaching warning when context is high and no recent compaction
  if (currentPercent >= APPROACHING_THRESHOLD) {
    return { state: 'approaching', age: 0 };
  }

  return null;
}
