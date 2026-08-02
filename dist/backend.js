import { isBedrockModelId } from './stdin.js';
/** GovCloud AWS regions carry the `us-gov-` prefix (e.g. us-gov-west-1). */
function isGovRegion(region) {
    return !!region && region.trim().toLowerCase().startsWith('us-gov-');
}
/** GovCloud Bedrock inference-profile IDs are prefixed `us-gov.` (vs `us.`, `eu.`, `apac.`). */
function isGovModelId(modelId) {
    return !!modelId && modelId.trim().toLowerCase().startsWith('us-gov.');
}
/**
 * Detect the active launch profile from signals the statusline subprocess can
 * actually see. Detection is deliberately env/stdin-based and requires NO
 * launcher changes.
 *
 * IMPORTANT — credentials are NOT reliable signals. With
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 (and the launchers' own subshell scoping),
 * ANTHROPIC_API_KEY and AWS_BEARER_TOKEN_BEDROCK are stripped before the
 * statusline runs. So the claude-vs-claude-ws split cannot use "is an API key
 * set" — it uses the OAuth subscription signal instead (see `hasSubscription`).
 *
 * Signal precedence:
 *   1. CLAUDE_HUD_PROFILE env override — explicit escape hatch, always wins.
 *   2. Bedrock (CLAUDE_CODE_USE_BEDROCK, or an anthropic.claude- model id):
 *        gov region OR us-gov. model prefix -> claude-gov, else claude-bedrock.
 *   3. Non-Bedrock: has OAuth subscription -> claude; otherwise -> claude-ws.
 *   4. Nothing recognized -> unknown.
 */
export function detectBackendProfile(stdin, opts = {}) {
    const env = opts.env ?? process.env;
    // 1. Explicit override — the belt-and-suspenders path if a launcher opts in
    //    by exporting CLAUDE_HUD_PROFILE. Only accept known values.
    const override = env.CLAUDE_HUD_PROFILE?.trim();
    if (override === 'claude' || override === 'claude-ws'
        || override === 'claude-bedrock' || override === 'claude-gov') {
        return override;
    }
    const modelId = stdin.model?.id;
    // 2. Bedrock — either the explicit flag or an anthropic.claude- model id.
    //    (The flag is visible to the statusline; the model id from stdin is
    //    never scrubbed, so this is robust even if the flag is somehow absent.)
    const isBedrock = env.CLAUDE_CODE_USE_BEDROCK === '1' || isBedrockModelId(modelId);
    if (isBedrock) {
        if (isGovRegion(env.AWS_REGION) || isGovModelId(modelId)) {
            return 'claude-gov';
        }
        return 'claude-bedrock';
    }
    // 3. Non-Bedrock on api.anthropic.com. The credential that would positively
    //    separate workspace from subscription (ANTHROPIC_API_KEY) is usually
    //    SCRUBBED before the statusline runs, so it's a weak POSITIVE signal at
    //    best and never a reliable NEGATIVE. Require a positive signal for each:
    //    - a real OAuth subscription (planName present) => bare `claude`;
    //    - an actually-visible API key with no subscription => `claude-ws`.
    //    When NEITHER is present the state is genuinely ambiguous (e.g. a
    //    subscription session whose usage API hasn't loaded yet, or a scrubbed
    //    workspace key) — return `unknown` so the caller falls back to the
    //    established plan/provider label rather than mislabeling.
    if (opts.hasSubscription) {
        return 'claude';
    }
    if (opts.hasApiKey) {
        return 'claude-ws';
    }
    return 'unknown';
}
/**
 * Human-facing label for a profile — the verbatim launcher name, matching the
 * command the user actually ran. `unknown` yields null so callers fall back to
 * the existing plan/provider label rather than printing "unknown".
 */
export function backendProfileLabel(profile) {
    return profile === 'unknown' ? null : profile;
}
//# sourceMappingURL=backend.js.map