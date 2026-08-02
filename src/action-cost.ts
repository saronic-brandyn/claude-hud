import * as os from 'node:os';
import { FileCache } from './file-cache.js';
import type { ToolEntry, AgentEntry } from './types.js';

export interface ActionCostEntry {
  toolType: string;
  totalCost: number;
}

interface ActionCostCache {
  /** Cost-by-tool-type aggregation: { "Agent": 4.50, "Bash": 1.20, ... } */
  costByTool: Record<string, number>;
  /** Last observed total_cost_usd to detect deltas */
  lastTotalCost: number;
  /** IDs of tools that were running during the last cost delta */
  lastActiveToolIds: string[];
}

const cache = new FileCache<ActionCostCache>({
  name: 'action-cost-cache',
  validate: (d): d is ActionCostCache =>
    d != null && typeof d === 'object'
    && typeof (d as ActionCostCache).lastTotalCost === 'number'
    && typeof (d as ActionCostCache).costByTool === 'object',
});

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
export function getActionCosts(
  totalCostUsd: number | undefined,
  tools: ToolEntry[],
  agents: AgentEntry[],
  threshold: number,
  sessionId?: string,
): ActionCostEntry[] | null {
  if (totalCostUsd == null) return null;

  const homeDir = os.homedir();
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

    const activeNames: string[] = [];
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
  } else if (costDelta < 0) {
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
  const entries: ActionCostEntry[] = Object.entries(costByTool)
    .map(([toolType, totalCost]) => ({ toolType, totalCost }))
    .filter(e => e.totalCost >= threshold)
    .sort((a, b) => b.totalCost - a.totalCost);

  return entries.length > 0 ? entries : null;
}
