import * as os from 'node:os';
import { FileCache } from './file-cache.js';
const cache = new FileCache({
    name: 'action-cost-cache',
    validate: (d) => d != null && typeof d === 'object'
        && typeof d.lastTotalCost === 'number'
        && typeof d.costByTool === 'object',
});
const defaultDeps = {
    homeDir: () => os.homedir(),
};
export function getActionCosts(totalCostUsd, tools, agents, threshold, sessionId, overrides = {}) {
    if (totalCostUsd == null)
        return null;
    const homeDir = { ...defaultDeps, ...overrides }.homeDir();
    const prev = cache.read(homeDir, sessionId);
    // First invocation — establish baseline
    if (!prev) {
        cache.write(homeDir, {
            costByTool: {},
            lastTotalCost: totalCostUsd,
            lastActiveToolIds: [],
        }, sessionId);
        return null;
    }
    const costDelta = totalCostUsd - prev.lastTotalCost;
    let costByTool = prev.costByTool;
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
        costByTool = { ...prev.costByTool };
        for (const name of activeNames) {
            costByTool[name] = (costByTool[name] ?? 0) + share;
        }
        cache.write(homeDir, {
            costByTool,
            lastTotalCost: totalCostUsd,
            lastActiveToolIds: runningTools.map(t => t.id),
        }, sessionId);
    }
    else if (costDelta < 0) {
        // Cost decreased (new session) — reset
        cache.write(homeDir, {
            costByTool: {},
            lastTotalCost: totalCostUsd,
            lastActiveToolIds: [],
        }, sessionId);
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