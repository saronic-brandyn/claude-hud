import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';
function getCachePath(homeDir) {
    return path.join(getHudPluginDir(homeDir), '.action-cost-cache.json');
}
function readCache(homeDir) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf8');
        const parsed = JSON.parse(content);
        if (typeof parsed.lastTotalCost !== 'number' || typeof parsed.costByTool !== 'object') {
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
 * Track cost attribution by tool type.
 *
 * Strategy: when total_cost_usd increases, attribute the delta to whichever
 * tools are currently "running" (tool_use without matching tool_result).
 * If multiple tools are running, split the delta evenly.
 * If no tools are running (model is thinking), attribute to "Thinking".
 *
 * Returns aggregated cost-by-tool-type, sorted descending.
 */
export function getActionCosts(totalCostUsd, tools, agents, threshold) {
    if (totalCostUsd == null)
        return null;
    const homeDir = os.homedir();
    const cache = readCache(homeDir);
    // First invocation — establish baseline
    if (!cache) {
        writeCache(homeDir, {
            costByTool: {},
            lastTotalCost: totalCostUsd,
            lastActiveToolIds: [],
        });
        return null;
    }
    const costDelta = totalCostUsd - cache.lastTotalCost;
    let costByTool = cache.costByTool;
    if (costDelta > 0) {
        // Cost increased — attribute to active tools
        const runningTools = tools.filter(t => t.status === 'running');
        const runningAgents = agents.filter(a => a.status === 'running');
        const activeNames = [];
        for (const tool of runningTools) {
            activeNames.push(tool.name);
        }
        for (const agent of runningAgents) {
            activeNames.push('Agent');
        }
        // If nothing is running, the model is generating a response
        if (activeNames.length === 0) {
            activeNames.push('Thinking');
        }
        // Split delta evenly among active tools
        const share = costDelta / activeNames.length;
        costByTool = { ...cache.costByTool };
        for (const name of activeNames) {
            costByTool[name] = (costByTool[name] ?? 0) + share;
        }
        writeCache(homeDir, {
            costByTool,
            lastTotalCost: totalCostUsd,
            lastActiveToolIds: runningTools.map(t => t.id),
        });
    }
    else if (costDelta < 0) {
        // Cost decreased (new session) — reset
        writeCache(homeDir, {
            costByTool: {},
            lastTotalCost: totalCostUsd,
            lastActiveToolIds: [],
        });
        return null;
    }
    // costDelta === 0: no change, use existing cache
    // Build sorted result, filtering by threshold
    const entries = Object.entries(costByTool)
        .map(([toolType, totalCost]) => ({ toolType, totalCost }))
        .filter(e => e.totalCost >= threshold)
        .sort((a, b) => b.totalCost - a.totalCost);
    return entries.length > 0 ? entries : null;
}
//# sourceMappingURL=action-cost.js.map