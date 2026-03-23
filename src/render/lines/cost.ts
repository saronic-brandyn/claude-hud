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

function parseDurationMinutes(duration: string): number | null {
  if (!duration || duration === '<1m') return null;
  const hourMatch = duration.match(/(\d+)h/);
  const minMatch = duration.match(/(\d+)m/);
  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const mins = minMatch ? parseInt(minMatch[1], 10) : 0;
  const total = hours * 60 + mins;
  return total > 0 ? total : null;
}

function getBurnRate(cost: number, duration: string): string | null {
  const mins = parseDurationMinutes(duration);
  if (!mins || mins < 1 || cost <= 0) return null;
  const perHour = cost / (mins / 60);
  return formatCost(perHour);
}

/** Expanded layout: "Cost ~$1.42 ($0.85/hr)" with optional token breakdown */
export function renderCostLine(ctx: RenderContext): string | null {
  const data = ctx.costData;
  if (!data) return null;

  const total = data.inputTokens + data.outputTokens + data.cacheWriteTokens + data.cacheReadTokens;
  if (total === 0) return null;

  const color = getCostColor(data.totalCost);
  const costStr = formatCost(data.totalCost);
  const burn = getBurnRate(data.totalCost, ctx.sessionDuration);
  const burnStr = burn ? ` ${dim(`(${burn}/hr)`)}` : '';
  let result = `${dim('Cost')} ${color}~${costStr}${RESET}${burnStr}`;

  if (ctx.config?.display?.showCostBreakdown) {
    const inStr = formatTokens(data.inputTokens + data.cacheWriteTokens + data.cacheReadTokens);
    const outStr = formatTokens(data.outputTokens);
    result += dim(` (in: ${inStr}, out: ${outStr})`);
  }

  return result;
}

/** Compact layout: "~$1.42 $0.85/hr" inline segment */
export function renderCostSegment(ctx: RenderContext): string | null {
  const data = ctx.costData;
  if (!data) return null;

  const total = data.inputTokens + data.outputTokens + data.cacheWriteTokens + data.cacheReadTokens;
  if (total === 0) return null;

  const color = getCostColor(data.totalCost);
  const burn = getBurnRate(data.totalCost, ctx.sessionDuration);
  const burnStr = burn ? dim(` ${burn}/hr`) : '';
  return `${color}~${formatCost(data.totalCost)}${RESET}${burnStr}`;
}
