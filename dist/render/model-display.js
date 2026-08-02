import { getProviderLabel } from '../stdin.js';
import { backendProfileLabel } from '../backend.js';
export function formatModelDisplay(model, ctx) {
    let effortSuffix = '';
    if (ctx.effortLevel && ctx.effortSymbol) {
        effortSuffix = ` ${ctx.effortSymbol} ${ctx.effortLevel}`;
    }
    else if (ctx.effortLevel) {
        effortSuffix = ` ${ctx.effortLevel}`;
    }
    const display = ctx.config?.display;
    // The launch-profile label is strictly more specific than getProviderLabel,
    // which collapses commercial Bedrock and GovCloud Bedrock to a single
    // "Bedrock". Prefer it; fall back when the profile is `unknown` (label null).
    const autoProvider = (ctx.backendProfile ? backendProfileLabel(ctx.backendProfile) : null)
        ?? getProviderLabel(ctx.stdin);
    if (display?.showProvider) {
        const providerLabel = display.providerName?.trim() || autoProvider;
        const core = `${model}${effortSuffix}`;
        return providerLabel ? `${providerLabel} | ${core}` : core;
    }
    return autoProvider ? `${model}${effortSuffix} | ${autoProvider}` : `${model}${effortSuffix}`;
}
//# sourceMappingURL=model-display.js.map