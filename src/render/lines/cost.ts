import type { RenderContext } from '../../types.js';
import { dim, green, yellow, red, RESET } from '../colors.js';

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  if (cost < 10) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(1)}`;
}

function getCostColor(cost: number): string {
  if (cost > 5.00) return '\x1b[31m'; // red
  if (cost >= 1.00) return '\x1b[33m'; // yellow
  if (cost >= 0.10) return '\x1b[32m'; // green
  return '\x1b[2m'; // dim
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function renderCostLine(ctx: RenderContext): string | null {
  const data = ctx.costData;
  if (!data) return null;

  const total = data.inputTokens + data.outputTokens + data.cacheWriteTokens + data.cacheReadTokens;
  if (total === 0) return null;

  const color = getCostColor(data.totalCost);
  const costStr = formatCost(data.totalCost);
  let result = `${dim('Cost')} ${color}~${costStr}${RESET}`;

  if (ctx.config?.display?.showCostBreakdown) {
    const inStr = formatTokens(data.inputTokens + data.cacheWriteTokens + data.cacheReadTokens);
    const outStr = formatTokens(data.outputTokens);
    result += dim(` (in: ${inStr}, out: ${outStr})`);
  }

  return result;
}

/** Compact inline cost segment for session-line */
export function renderCostSegment(ctx: RenderContext): string | null {
  const data = ctx.costData;
  if (!data) return null;

  const total = data.inputTokens + data.outputTokens + data.cacheWriteTokens + data.cacheReadTokens;
  if (total === 0) return null;

  const color = getCostColor(data.totalCost);
  return `${color}~${formatCost(data.totalCost)}${RESET}`;
}
