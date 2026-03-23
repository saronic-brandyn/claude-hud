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
const MODEL_PRICING = {
    // Opus 4.6 / 4.5
    'opus-4-6': { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.50 },
    'opus-4-5': { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.50 },
    // Opus 4.1 / 4.0 (legacy, higher pricing)
    'opus-4-1': { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.50 },
    'opus-4': { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.50 },
    // Sonnet 4.x
    'sonnet-4-6': { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
    'sonnet-4-5': { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
    'sonnet-4': { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
    // Haiku 4.5
    'haiku-4-5': { inputPerM: 1, outputPerM: 5, cacheWritePerM: 1.25, cacheReadPerM: 0.10 },
    'haiku': { inputPerM: 1, outputPerM: 5, cacheWritePerM: 1.25, cacheReadPerM: 0.10 },
    // Generic fallbacks
    'opus': { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.50 },
    'sonnet': { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.30 },
};
const DEFAULT_PRICING = MODEL_PRICING['opus'];
function findPricing(modelId) {
    const lower = modelId.toLowerCase();
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
        if (lower.includes(key))
            return pricing;
    }
    return DEFAULT_PRICING;
}
export function calculateCost(tokens) {
    let totalInputCost = 0;
    let totalOutputCost = 0;
    if (tokens.byModel.length > 0) {
        for (const m of tokens.byModel) {
            const pricing = findPricing(m.model);
            totalInputCost += (m.inputTokens / 1_000_000) * pricing.inputPerM;
            totalInputCost += (m.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerM;
            totalInputCost += (m.cacheReadTokens / 1_000_000) * pricing.cacheReadPerM;
            totalOutputCost += (m.outputTokens / 1_000_000) * pricing.outputPerM;
        }
    }
    else {
        const pricing = DEFAULT_PRICING;
        totalInputCost += (tokens.inputTokens / 1_000_000) * pricing.inputPerM;
        totalInputCost += (tokens.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerM;
        totalInputCost += (tokens.cacheReadTokens / 1_000_000) * pricing.cacheReadPerM;
        totalOutputCost += (tokens.outputTokens / 1_000_000) * pricing.outputPerM;
    }
    return {
        totalCost: totalInputCost + totalOutputCost,
        inputCost: totalInputCost,
        outputCost: totalOutputCost,
    };
}
//# sourceMappingURL=pricing.js.map