/**
 * Cumulative token usage and cost estimation module.
 * Calculates session cost based on model-specific pricing.
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

interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheWritePerM: number;
  cacheReadPerM: number;
}

// Pricing from docs.anthropic.com/en/docs/about-claude/pricing (2026-03-22)
// Enterprise plans are billed at these same API rates.
// Bedrock pricing differs — see AWS Bedrock pricing page.
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4.6 / 4.5
  'opus-4-6':   { inputPerM: 5,  outputPerM: 25, cacheWritePerM: 6.25,  cacheReadPerM: 0.50 },
  'opus-4-5':   { inputPerM: 5,  outputPerM: 25, cacheWritePerM: 6.25,  cacheReadPerM: 0.50 },
  // Opus 4.1 / 4.0 (legacy, higher pricing)
  'opus-4-1':   { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.50 },
  'opus-4':     { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.50 },
  // Sonnet 4.x
  'sonnet-4-6': { inputPerM: 3,  outputPerM: 15, cacheWritePerM: 3.75,  cacheReadPerM: 0.30 },
  'sonnet-4-5': { inputPerM: 3,  outputPerM: 15, cacheWritePerM: 3.75,  cacheReadPerM: 0.30 },
  'sonnet-4':   { inputPerM: 3,  outputPerM: 15, cacheWritePerM: 3.75,  cacheReadPerM: 0.30 },
  // Haiku 4.5
  'haiku-4-5':  { inputPerM: 1,  outputPerM: 5,  cacheWritePerM: 1.25,  cacheReadPerM: 0.10 },
  'haiku':      { inputPerM: 1,  outputPerM: 5,  cacheWritePerM: 1.25,  cacheReadPerM: 0.10 },
  // Generic fallbacks (match newest pricing for each family)
  'opus':       { inputPerM: 5,  outputPerM: 25, cacheWritePerM: 6.25,  cacheReadPerM: 0.50 },
  'sonnet':     { inputPerM: 3,  outputPerM: 15, cacheWritePerM: 3.75,  cacheReadPerM: 0.30 },
};

const DEFAULT_PRICING: ModelPricing = MODEL_PRICING['opus'];

function findPricing(modelId: string): ModelPricing {
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) return pricing;
  }
  return DEFAULT_PRICING;
}

export function calculateCost(tokens: CumulativeTokenUsage): CostEstimate {
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
  } else {
    // Fallback: use aggregate tokens with default pricing
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
