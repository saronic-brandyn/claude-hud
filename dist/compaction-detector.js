import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';
/** Context percent threshold for approaching warning */
const APPROACHING_THRESHOLD = 85;
/** Minimum percent drop to count as a compaction event */
const COMPACTION_THRESHOLD = 10;
/** How long to display the compaction indicator (ms) */
const INDICATOR_DURATION_MS = 8000;
const defaultDeps = {
    homeDir: () => os.homedir(),
    now: () => Date.now(),
};
function getCachePath(homeDir) {
    return path.join(getHudPluginDir(homeDir), '.compaction-cache.json');
}
function readCache(homeDir) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf8');
        const parsed = JSON.parse(content);
        if (typeof parsed.percent !== 'number' || typeof parsed.timestamp !== 'number') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function writeCache(homeDir, cache) {
    try {
        const cachePath = getCachePath(homeDir);
        const cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        atomicWriteFileSync(cachePath, JSON.stringify(cache));
    }
    catch {
        // Ignore cache write failures
    }
}
/**
 * Detect context compaction events by tracking percentage drops.
 * Returns a CompactionEvent if a recent compaction was detected (within INDICATOR_DURATION_MS).
 */
export function detectCompaction(currentPercent, overrides = {}) {
    const deps = { ...defaultDeps, ...overrides };
    const now = deps.now();
    const homeDir = deps.homeDir();
    const previous = readCache(homeDir);
    const cache = { percent: currentPercent, timestamp: now };
    if (previous) {
        const drop = previous.percent - currentPercent;
        if (drop >= COMPACTION_THRESHOLD) {
            // New compaction detected
            cache.compactedAt = now;
            cache.compactedDelta = drop;
        }
        else if (previous.compactedAt && now - previous.compactedAt < INDICATOR_DURATION_MS) {
            // Carry forward recent compaction event
            cache.compactedAt = previous.compactedAt;
            cache.compactedDelta = previous.compactedDelta;
        }
    }
    writeCache(homeDir, cache);
    if (cache.compactedAt && cache.compactedDelta && now - cache.compactedAt < INDICATOR_DURATION_MS) {
        return { state: 'compacted', delta: cache.compactedDelta, age: now - cache.compactedAt };
    }
    // Approaching warning when context is high and no recent compaction
    if (currentPercent >= APPROACHING_THRESHOLD) {
        return { state: 'approaching', age: 0 };
    }
    return null;
}
//# sourceMappingURL=compaction-detector.js.map