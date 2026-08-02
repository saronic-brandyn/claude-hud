import { resolveSessionCost, formatUsd } from '../../cost.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';
/** Tool types shown in the cost breakdown; the tail of the list is noise. */
const MAX_ACTION_COST_ENTRIES = 5;
export function renderCostEstimate(ctx) {
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
    let line = query?.isActive && query.cost > 0
        ? `${session} (${t('label.thisQuery')} ${formatUsd(query.cost)})`
        : session;
    // Cost attributed by tool type — "where is the money going", which neither
    // the running total nor the per-query figure answers. Top 5 only; the tail
    // of a cost breakdown is noise.
    const actions = ctx.actionCosts;
    if (actions?.length) {
        const parts = actions
            .slice(0, MAX_ACTION_COST_ENTRIES)
            .map((entry) => `${entry.toolType} ${formatUsd(entry.totalCost)}`);
        if (parts.length > 0) {
            line += ` [${parts.join(', ')}]`;
        }
    }
    return label(line, ctx.config?.colors);
}
//# sourceMappingURL=cost.js.map