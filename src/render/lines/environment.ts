import type { RenderContext } from '../../types.js';
import { dim, RESET } from '../colors.js';

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;

  if (display?.showConfigCounts === false) {
    return null;
  }

  // Auto-hide counts after configured duration (default 30s, 0 = never hide)
  // MCP errors bypass auto-hide — they should always be visible
  const mcpErrorCount = ctx.transcript.mcpErrors.size;
  const hideAfter = display?.countsHideAfterSeconds ?? 30;
  if (hideAfter > 0 && mcpErrorCount === 0 && ctx.transcript.sessionStart) {
    const age = Date.now() - ctx.transcript.sessionStart.getTime();
    if (age > hideAfter * 1000) {
      return null;
    }
  }

  const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
  const threshold = display?.environmentThreshold ?? 0;

  if (totalCounts === 0 || totalCounts < threshold) {
    return null;
  }

  const parts: string[] = [];

  if (ctx.claudeMdCount > 0) {
    parts.push(`${ctx.claudeMdCount} CLAUDE.md`);
  }

  if (ctx.rulesCount > 0) {
    parts.push(`${ctx.rulesCount} rules`);
  }

  if (ctx.mcpCount > 0) {
    if (mcpErrorCount > 0) {
      const errorNames = Array.from(ctx.transcript.mcpErrors).slice(0, 3).join(', ');
      const suffix = mcpErrorCount > 3 ? ` +${mcpErrorCount - 3}` : '';
      parts.push(`${ctx.mcpCount} MCPs \x1b[31m⚠ ${errorNames}${suffix}${RESET}`);
    } else {
      parts.push(`${ctx.mcpCount} MCPs`);
    }
  }

  if (ctx.hooksCount > 0) {
    parts.push(`${ctx.hooksCount} hooks`);
  }

  if (parts.length === 0) {
    return null;
  }

  return dim(parts.join(' | '));
}
