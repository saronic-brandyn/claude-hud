import { label, red } from "../colors.js";
import { t } from "../../i18n/index.js";
/** How many failing server names to spell out before collapsing to a count. */
const MAX_NAMED_MCP_ERRORS = 3;
export function renderEnvironmentLine(ctx) {
    const display = ctx.config?.display;
    const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const threshold = display?.environmentThreshold ?? 0;
    const showCounts = display?.showConfigCounts === true;
    const showOutputStyle = display?.showOutputStyle === true;
    // Default-on, so `!== false` rather than the `=== true` the opt-in toggles
    // above use. Gated once at the source: both the count-suffix form and the
    // standalone bypass below read this, so the flag cannot be honoured in one
    // place and leak in the other.
    const showMcpErrors = display?.showMcpErrors !== false;
    const mcpErrors = showMcpErrors ? (ctx.transcript?.mcpErrors ?? []) : [];
    const parts = [];
    let renderedMcpCount = false;
    if (showCounts && totalCounts >= threshold && totalCounts > 0) {
        if (ctx.claudeMdCount > 0) {
            parts.push(`${ctx.claudeMdCount} CLAUDE.md`);
        }
        if (ctx.rulesCount > 0) {
            parts.push(`${ctx.rulesCount} ${t("label.rules")}`);
        }
        if (ctx.mcpCount > 0) {
            parts.push(mcpErrors.length > 0
                ? `${ctx.mcpCount} MCPs ${formatMcpErrors(mcpErrors)}`
                : `${ctx.mcpCount} MCPs`);
            renderedMcpCount = true;
        }
        if (ctx.hooksCount > 0) {
            parts.push(`${ctx.hooksCount} ${t("label.hooks")}`);
        }
    }
    if (showOutputStyle && ctx.outputStyle) {
        parts.push(`style: ${ctx.outputStyle}`);
    }
    // A failing MCP server bypasses the config-count gate. The counts are
    // ambient detail you switch off once you have read them; an erroring server
    // is a live fault, and hiding it behind an *unrelated* display toggle is how
    // a broken tool goes unnoticed for a whole session. `showMcpErrors` is the
    // one related toggle, so it does gate this (see the flag's doc comment).
    if (mcpErrors.length > 0 && !renderedMcpCount) {
        parts.push(formatMcpErrors(mcpErrors));
    }
    if (parts.length === 0) {
        return null;
    }
    return label(parts.join(" | "), ctx.config?.colors);
}
/** `⚠ github, tenable +2` — names first, then an overflow count. */
function formatMcpErrors(mcpErrors) {
    const named = mcpErrors.slice(0, MAX_NAMED_MCP_ERRORS).join(", ");
    const overflow = mcpErrors.length - MAX_NAMED_MCP_ERRORS;
    const suffix = overflow > 0 ? ` +${overflow}` : "";
    return red(`⚠ ${named}${suffix}`);
}
//# sourceMappingURL=environment.js.map