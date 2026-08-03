/**
 * Authentication info for the current Claude Code login, derived from the
 * `oauthAccount` block Claude Code persists in {CLAUDE_CONFIG_DIR}.json.
 *
 *   method: human-readable auth/plan label (e.g. "Claude Max 20x", "API Key")
 *   user:   account identifier (email local part, falling back to displayName)
 */
export interface AuthInfo {
    method: string | null;
    user: string | null;
}
/**
 * Derives auth info from the parsed contents of {CLAUDE_CONFIG_DIR}.json.
 * Pure so it can be tested without touching the filesystem.
 */
export declare function deriveAuthInfo(claudeJson: unknown, env?: NodeJS.ProcessEnv): AuthInfo;
/**
 * Reads auth info for the current login. Never throws.
 *
 * claude.json is the user's whole CLI config — 73 KB on a real host, and it
 * grows with project history. The status line runs on every interaction, so
 * parsing it per tick is not free. Instead the DERIVED two fields are cached
 * and invalidated on (mtimeMs, size), turning the steady-state cost into a
 * stat plus a ~100-byte read.
 *
 * This matters beyond performance: it is what lets launch-profile detection
 * read auth unconditionally in index.ts, instead of taking its signal from the
 * showAuth/showAuthUser DISPLAY flags. A display toggle should never decide
 * whether a detection input is available.
 */
export declare function readAuthInfo(): AuthInfo;
export declare function truncateUser(user: string, maxLength: number): string;
/**
 * Builds the standalone auth segment for the end of the first HUD line,
 * honoring the showAuth / showAuthUser / authUserLength display settings.
 * Returns e.g. "Claude Max 20x · yukinosh…", or null when nothing to show.
 */
export declare function formatAuthSegment(info: AuthInfo | null | undefined, display: {
    showAuth?: boolean;
    showAuthUser?: boolean;
    authUserLength?: number;
} | undefined): string | null;
//# sourceMappingURL=auth.d.ts.map