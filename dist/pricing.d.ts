/**
 * Session cost estimation based on model-specific pricing.
 * Prices from docs.anthropic.com/en/docs/about-claude/pricing (2026-03-22).
 * Enterprise plans billed at same API rates.
 *
 * Limitation: This estimates cost from the current context window snapshot.
 * It does not track cumulative tokens across model switches (e.g., haiku
 * subagents). The actual session cost shown by Claude Code at session end
 * will be higher for multi-model sessions.
 */
export interface ModelTokenUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
}
export interface CumulativeTokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalCost: number;
    byModel: ModelTokenUsage[];
}
export interface CostEstimate {
    totalCost: number;
    inputCost: number;
    outputCost: number;
}
export declare function calculateCost(tokens: CumulativeTokenUsage): CostEstimate;
//# sourceMappingURL=pricing.d.ts.map