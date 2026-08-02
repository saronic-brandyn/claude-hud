import type { StdinData } from './types.js';
/**
 * The four Saronic launch profiles the HUD distinguishes:
 *   claude          — platform.claude.com subscription (OAuth, api.anthropic.com)
 *   claude-ws       — workspace-scoped API key (api.anthropic.com)
 *   claude-bedrock  — commercial Bedrock (us.anthropic.* inference profiles)
 *   claude-gov      — GovCloud Bedrock (us-gov.anthropic.* inference profiles)
 *
 * `unknown` is the honest fallback when no signal identifies the backend
 * (e.g. a third-party gateway, or a stripped-down env we don't recognize).
 */
export type BackendProfile = 'claude' | 'claude-ws' | 'claude-bedrock' | 'claude-gov' | 'unknown';
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
export declare function detectBackendProfile(stdin: StdinData, opts?: {
    env?: NodeJS.ProcessEnv;
    hasSubscription?: boolean;
    hasApiKey?: boolean;
}): BackendProfile;
/**
 * Human-facing label for a profile — the verbatim launcher name, matching the
 * command the user actually ran. `unknown` yields null so callers fall back to
 * the existing plan/provider label rather than printing "unknown".
 */
export declare function backendProfileLabel(profile: BackendProfile): string | null;
//# sourceMappingURL=backend.d.ts.map