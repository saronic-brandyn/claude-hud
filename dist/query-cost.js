import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';
/** Time (ms) of stable cost before considering a query complete */
const SETTLE_MS = 2000;
const defaultDeps = {
    homeDir: () => os.homedir(),
    now: () => Date.now(),
};
function getCachePath(homeDir) {
    return path.join(getHudPluginDir(homeDir), '.cost-cache.json');
}
function readCache(homeDir) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf8');
        const parsed = JSON.parse(content);
        if (typeof parsed.totalCost !== 'number' || typeof parsed.queryStart !== 'number') {
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
 * Track per-query cost by detecting deltas in cumulative total_cost_usd.
 * Uses a file-based cache to persist state across ~300ms statusline invocations.
 */
export function getQueryCost(totalCostUsd, overrides = {}) {
    if (totalCostUsd == null)
        return null;
    const deps = { ...defaultDeps, ...overrides };
    const now = deps.now();
    const homeDir = deps.homeDir();
    const cache = readCache(homeDir);
    // First invocation — establish baseline
    if (!cache) {
        writeCache(homeDir, {
            totalCost: totalCostUsd,
            queryStart: totalCostUsd,
            queryCost: 0,
            lastChangeTs: now,
            settled: true,
        });
        return null;
    }
    const costDelta = totalCostUsd - cache.totalCost;
    if (costDelta > 0) {
        // Cost is rising
        let queryStart = cache.queryStart;
        if (cache.settled) {
            // Was settled → new query starting
            queryStart = cache.totalCost;
        }
        writeCache(homeDir, {
            totalCost: totalCostUsd,
            queryStart,
            queryCost: cache.queryCost,
            lastChangeTs: now,
            settled: false,
        });
        const runningCost = totalCostUsd - queryStart;
        return runningCost > 0 ? { cost: runningCost, isActive: true } : null;
    }
    if (costDelta === 0) {
        // Cost unchanged
        const pastThreshold = (now - cache.lastChangeTs) > SETTLE_MS;
        if (!cache.settled && pastThreshold) {
            // Just settled — record completed query cost
            const completedCost = cache.totalCost - cache.queryStart;
            if (completedCost > 0) {
                writeCache(homeDir, {
                    totalCost: cache.totalCost,
                    queryStart: cache.totalCost,
                    queryCost: completedCost,
                    lastChangeTs: cache.lastChangeTs,
                    settled: true,
                });
                return { cost: completedCost, isActive: false };
            }
        }
        if (!cache.settled) {
            // Still active (within settle window)
            const runningCost = cache.totalCost - cache.queryStart;
            return runningCost > 0 ? { cost: runningCost, isActive: true } : null;
        }
        // Already settled — show last completed query cost
        return cache.queryCost > 0 ? { cost: cache.queryCost, isActive: false } : null;
    }
    // Cost decreased (session reset) — reinitialize
    writeCache(homeDir, {
        totalCost: totalCostUsd,
        queryStart: totalCostUsd,
        queryCost: 0,
        lastChangeTs: now,
        settled: true,
    });
    return null;
}
//# sourceMappingURL=query-cost.js.map