import { getContextPercent, getBufferedPercent, } from "../../stdin.js";
import { coloredBar, label, getContextColor, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import { progressLabel, } from "./label-align.js";
import { formatTokens, formatContextValue } from "../../utils/format.js";
import { createDebug } from "../../debug.js";
const debug = createDebug("context");
export function renderIdentityLine(ctx, labelOptions = {}) {
    const autoCompactWindow = ctx.config?.display?.autoCompactWindow ?? null;
    const rawPercent = getContextPercent(ctx.stdin, autoCompactWindow);
    const bufferedPercent = getBufferedPercent(ctx.stdin, autoCompactWindow);
    const autocompactMode = ctx.config?.display?.autocompactBuffer ?? "enabled";
    const percent = autocompactMode === "disabled" ? rawPercent : bufferedPercent;
    const colors = ctx.config?.colors;
    if (autocompactMode === "disabled") {
        debug(`autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
    }
    const display = ctx.config?.display;
    const contextThresholds = {
        warning: display?.contextWarningThreshold,
        critical: display?.contextCriticalThreshold,
    };
    const contextValueMode = display?.contextValue ?? "percent";
    const contextValue = formatContextValue(ctx, percent, contextValueMode);
    const contextValueDisplay = `${getContextColor(percent, colors, contextThresholds)}${contextValue}${RESET}`;
    let line = display?.showContextBar !== false
        ? `${progressLabel("label.context", colors, labelOptions)} ${coloredBar(percent, getAdaptiveBarWidth(), colors, contextThresholds)} ${contextValueDisplay}`
        : `${progressLabel("label.context", colors, labelOptions)} ${contextValueDisplay}`;
    // Per-tick token delta — the rate at which this session is consuming
    // context, which the static percentage cannot show.
    if (ctx.contextDelta != null && ctx.contextDelta !== 0) {
        const sign = ctx.contextDelta > 0 ? "+" : "";
        line += label(` ${sign}${formatTokens(ctx.contextDelta)}`, colors);
    }
    // Compaction state. `approaching` is the half worth having: upstream's
    // showCompactions is a retrospective tally, whereas this fires BEFORE the
    // compaction while there is still time to wrap up or /compact deliberately.
    if (ctx.compaction) {
        line += ctx.compaction.state === "approaching"
            ? ` ${getContextColor(100, colors, contextThresholds)}${t("label.compactionApproaching")}${RESET}`
            : ` ${getContextColor(0, colors, contextThresholds)}${t("label.compacted")}${ctx.compaction.delta ? ` -${ctx.compaction.delta}%` : ""}${RESET}`;
    }
    if (display?.showTokenBreakdown !== false && percent >= (display?.contextCriticalThreshold ?? 85)) {
        const usage = ctx.stdin.context_window?.current_usage;
        if (usage) {
            const input = formatTokens(usage.input_tokens ?? 0);
            const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0));
            line += label(` (${t("format.in")}: ${input}, ${t("format.cache")}: ${cache})`, colors);
        }
    }
    return line;
}
//# sourceMappingURL=identity.js.map