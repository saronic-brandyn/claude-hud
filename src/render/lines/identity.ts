import type { RenderContext } from '../../types.js';
import { getContextPercent, getBufferedPercent } from '../../stdin.js';
import { coloredBar, coloredBarAscii, dim, warning, getContextColor, RESET } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
import { formatTokens, formatContextValue } from '../format-helpers.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

export function renderIdentityLine(ctx: RenderContext): string {
  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;
  const colors = ctx.config?.colors;

  if (DEBUG && autocompactMode === 'disabled') {
    console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
  }

  const display = ctx.config?.display;
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent, colors)}${contextValue}${RESET}`;

  const ascii = display?.asciiMode ?? false;
  const barFn = ascii ? coloredBarAscii : coloredBar;

  const velocityStr = ctx.contextVelocity
    ? dim(` (+${formatTokens(ctx.contextVelocity)}/min)`)
    : '';

  let compactStr = '';
  if (ctx.compactionEvent) {
    if (ctx.compactionEvent.state === 'compacted') {
      compactStr = ` ${warning(ascii ? `! -${ctx.compactionEvent.delta}%` : `⚡ -${ctx.compactionEvent.delta}%`, colors)}`;
    } else {
      compactStr = ` ${warning(ascii ? '! ~85%' : '⚠ ~85%', colors)}`;
    }
  }

  let line = display?.showContextBar !== false
    ? `${dim('Context')} ${barFn(percent, getAdaptiveBarWidth(), colors)} ${contextValueDisplay}${velocityStr}${compactStr}`
    : `${dim('Context')} ${contextValueDisplay}${velocityStr}${compactStr}`;

  if (display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += dim(` (in: ${input}, cache: ${cache})`);
    }
  }

  return line;
}

