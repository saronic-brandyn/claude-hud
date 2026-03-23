import { getTotalTokens } from '../stdin.js';
import { dim, getQuotaColor, RESET } from './colors.js';
export function formatTokens(n) {
    if (n >= 1000000) {
        return `${(n / 1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${(n / 1000).toFixed(0)}k`;
    }
    return n.toString();
}
export function formatContextValue(ctx, percent, mode) {
    if (mode === 'tokens') {
        const totalTokens = getTotalTokens(ctx.stdin);
        const size = ctx.stdin.context_window?.context_window_size ?? 0;
        if (size > 0) {
            return `${formatTokens(totalTokens)}/${formatTokens(size)} (${percent}%)`;
        }
        return formatTokens(totalTokens);
    }
    if (mode === 'usable') {
        // Usable = % of 80% threshold (where autocompact triggers)
        const usablePercent = Math.min(100, Math.round((percent / 80) * 100));
        return `${usablePercent}%`;
    }
    if (mode === 'remaining') {
        return `${Math.max(0, 100 - percent)}%`;
    }
    return `${percent}%`;
}
export function formatUsagePercent(percent, colors) {
    if (percent === null) {
        return dim('--');
    }
    const color = getQuotaColor(percent, colors);
    return `${color}${percent}%${RESET}`;
}
export function formatUsageError(error) {
    if (!error)
        return '';
    if (error === 'rate-limited')
        return ' (syncing...)';
    if (error.startsWith('http-'))
        return ` (${error.slice(5)})`;
    return ` (${error})`;
}
export function formatResetTime(resetAt) {
    if (!resetAt)
        return '';
    const now = new Date();
    const diffMs = resetAt.getTime() - now.getTime();
    if (diffMs <= 0)
        return '';
    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins < 60)
        return `${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        if (remHours > 0)
            return `${days}d ${remHours}h`;
        return `${days}d`;
    }
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
//# sourceMappingURL=format-helpers.js.map