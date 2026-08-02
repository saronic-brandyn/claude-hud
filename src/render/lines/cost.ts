import type { RenderContext } from '../../types.js';
import { resolveSessionCost, formatUsd } from '../../cost.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';

export function renderCostEstimate(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showCost !== true) {
    return null;
  }

  const cost = resolveSessionCost(ctx.stdin, ctx.transcript.sessionTokens, {
    allowRoutedCost: ctx.config?.display?.showRoutedCost === true,
  });
  if (!cost) {
    return null;
  }

  const labelKey = cost.source === 'native' ? 'label.cost' : 'label.estimatedCost';
  const session = `${t(labelKey)} ${formatUsd(cost.totalUsd)}`;

  // Append the CURRENT query's cost while it is in flight. The session total
  // only ever climbs, so it cannot answer "is this particular turn expensive?"
  // — which is the question you can still act on.
  const query = ctx.queryCost;
  if (query?.isActive && query.cost > 0) {
    return label(`${session} (${t('label.thisQuery')} ${formatUsd(query.cost)})`, ctx.config?.colors);
  }

  return label(session, ctx.config?.colors);
}
