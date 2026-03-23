import type { RenderContext } from '../../types.js';
import { dim, RESET } from '../colors.js';
import { formatTokens } from '../format-helpers.js';

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  if (cost < 10) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(1)}`;
}

function getCostColor(cost: number): string {
  if (cost > 5.00) return '\x1b[31m';  // red
  if (cost >= 1.00) return '\x1b[33m'; // yellow
  if (cost >= 0.10) return '\x1b[32m'; // green
  return '\x1b[2m';                     // dim
}

function getBurnRate(cost: number, durationMs: number | undefined): string | null {
  if (!durationMs || durationMs < 60_000 || cost <= 0) return null;
  const hours = durationMs / 3_600_000;
  return formatCost(cost / hours);
}

/** Expanded layout: "Cost $1.42 ($0.85/hr)" with optional lines changed */
export function renderCostLine(ctx: RenderContext): string | null {
  const data = ctx.costData;
  const cost = data?.total_cost_usd;
  if (cost == null || cost <= 0) return null;

  const color = getCostColor(cost);
  const costStr = formatCost(cost);
  const burn = getBurnRate(cost, data?.total_duration_ms);
  const burnStr = burn ? ` ${dim(`(${burn}/hr)`)}` : '';
  const queryStr = formatQueryCost(ctx);
  let result = `${dim('Cost')} ${color}${costStr}${RESET}${queryStr}${burnStr}`;

  if (ctx.config?.display?.showCostBreakdown) {
    // Show token counts (lines changed is already on the project line)
    const inTokens = ctx.stdin.context_window?.total_input_tokens;
    const outTokens = ctx.stdin.context_window?.total_output_tokens;
    if (inTokens || outTokens) {
      result += dim(` (in: ${formatTokens(inTokens ?? 0)}, out: ${formatTokens(outTokens ?? 0)})`);
    }
  }

  return result;
}

function formatQueryCost(ctx: RenderContext): string {
  const qc = ctx.queryCost;
  if (!qc || qc.cost < 0.001) return '';
  const label = qc.cost < 0.01 ? '<$0.01' : `$${qc.cost.toFixed(2)}`;
  return dim(` (+${label})`);
}

/** Compact layout: "$1.42 $0.85/hr" inline segment */
export function renderCostSegment(ctx: RenderContext): string | null {
  const data = ctx.costData;
  const cost = data?.total_cost_usd;
  if (cost == null || cost <= 0) return null;

  const color = getCostColor(cost);
  const queryStr = formatQueryCost(ctx);
  const burn = getBurnRate(cost, data?.total_duration_ms);
  const burnStr = burn ? dim(` ${burn}/hr`) : '';
  return `${color}${formatCost(cost)}${RESET}${queryStr}${burnStr}`;
}
