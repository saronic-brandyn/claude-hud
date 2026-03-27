import type { ToolEntry, AgentEntry } from './types.js';
export interface ActionCostEntry {
    toolType: string;
    totalCost: number;
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
export declare function getActionCosts(totalCostUsd: number | undefined, tools: ToolEntry[], agents: AgentEntry[], threshold: number): ActionCostEntry[] | null;
//# sourceMappingURL=action-cost.d.ts.map