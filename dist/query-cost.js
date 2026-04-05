import * as os from 'node:os';
import { FileCache } from './file-cache.js';
/** Time (ms) of stable cost before considering a query complete */
const SETTLE_MS = 2000;
const defaultDeps = {
    homeDir: () => os.homedir(),
    now: () => Date.now(),
};
const cache = new FileCache({
    name: 'cost-cache',
    validate: (d) => d != null && typeof d === 'object'
        && typeof d.totalCost === 'number'
        && typeof d.queryStart === 'number',
});
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
    const sid = deps.sessionId;
    const prev = cache.read(homeDir, sid);
    // First invocation — establish baseline
    if (!prev) {
        cache.write(homeDir, {
            totalCost: totalCostUsd,
            queryStart: totalCostUsd,
            queryCost: 0,
            lastChangeTs: now,
            settled: true,
        }, sid);
        return null;
    }
    const costDelta = totalCostUsd - prev.totalCost;
    if (costDelta > 0) {
        // Cost is rising
        let queryStart = prev.queryStart;
        if (prev.settled) {
            // Was settled → new query starting
            queryStart = prev.totalCost;
        }
        cache.write(homeDir, {
            totalCost: totalCostUsd,
            queryStart,
            queryCost: prev.queryCost,
            lastChangeTs: now,
            settled: false,
        }, sid);
        const runningCost = totalCostUsd - queryStart;
        return runningCost > 0 ? { cost: runningCost, isActive: true } : null;
    }
    if (costDelta === 0) {
        // Cost unchanged
        const pastThreshold = (now - prev.lastChangeTs) > SETTLE_MS;
        if (!prev.settled && pastThreshold) {
            // Just settled — record completed query cost
            const completedCost = prev.totalCost - prev.queryStart;
            if (completedCost > 0) {
                cache.write(homeDir, {
                    totalCost: prev.totalCost,
                    queryStart: prev.totalCost,
                    queryCost: completedCost,
                    lastChangeTs: prev.lastChangeTs,
                    settled: true,
                }, sid);
                return { cost: completedCost, isActive: false };
            }
        }
        if (!prev.settled) {
            // Still active (within settle window)
            const runningCost = prev.totalCost - prev.queryStart;
            return runningCost > 0 ? { cost: runningCost, isActive: true } : null;
        }
        // Already settled — show last completed query cost
        return prev.queryCost > 0 ? { cost: prev.queryCost, isActive: false } : null;
    }
    // Cost decreased (session reset) — reinitialize
    cache.write(homeDir, {
        totalCost: totalCostUsd,
        queryStart: totalCostUsd,
        queryCost: 0,
        lastChangeTs: now,
        settled: true,
    }, sid);
    return null;
}
//# sourceMappingURL=query-cost.js.map