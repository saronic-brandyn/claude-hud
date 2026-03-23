export type QueryCostDeps = {
    homeDir: () => string;
    now: () => number;
};
export interface QueryCostInfo {
    cost: number;
    isActive: boolean;
}
/**
 * Track per-query cost by detecting deltas in cumulative total_cost_usd.
 * Uses a file-based cache to persist state across ~300ms statusline invocations.
 */
export declare function getQueryCost(totalCostUsd: number | undefined, overrides?: Partial<QueryCostDeps>): QueryCostInfo | null;
//# sourceMappingURL=query-cost.d.ts.map