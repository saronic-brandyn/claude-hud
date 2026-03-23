import { dim } from '../colors.js';
export function renderEnvironmentLine(ctx) {
    const display = ctx.config?.display;
    if (display?.showConfigCounts === false) {
        return null;
    }
    // Auto-hide counts after configured duration (default 30s, 0 = never hide)
    const hideAfter = display?.countsHideAfterSeconds ?? 30;
    if (hideAfter > 0 && ctx.transcript.sessionStart) {
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
    const parts = [];
    if (ctx.claudeMdCount > 0) {
        parts.push(`${ctx.claudeMdCount} CLAUDE.md`);
    }
    if (ctx.rulesCount > 0) {
        parts.push(`${ctx.rulesCount} rules`);
    }
    if (ctx.mcpCount > 0) {
        parts.push(`${ctx.mcpCount} MCPs`);
    }
    if (ctx.hooksCount > 0) {
        parts.push(`${ctx.hooksCount} hooks`);
    }
    if (parts.length === 0) {
        return null;
    }
    return dim(parts.join(' | '));
}
//# sourceMappingURL=environment.js.map