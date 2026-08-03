import * as fs from 'node:fs';
import * as os from 'node:os';
import { getClaudeConfigJsonPath } from './claude-config-dir.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import { FileCache } from './file-cache.js';
const EMPTY_AUTH_INFO = { method: null, user: null };
const API_KEY_AUTH_INFO = { method: 'API Key', user: null };
function hasApiKey(env) {
    return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}
// Strip ANSI sequences and control/bidi characters so values from
// claude.json can never smuggle escape sequences into the terminal.
function sanitizeValue(value) {
    return sanitizeDisplayText(value).trim();
}
function readString(obj, key) {
    const value = obj[key];
    if (typeof value !== 'string') {
        return null;
    }
    const sanitized = sanitizeValue(value);
    return sanitized.length > 0 ? sanitized : null;
}
/**
 * Formats an organizationType value into a display label:
 * "claude_max" → "Claude Max", "claude_pro" → "Claude Pro".
 */
function formatOrgType(orgType) {
    return orgType
        .split('_')
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' ');
}
/**
 * Extracts a multiplier suffix from a rate-limit tier value:
 * "default_claude_max_20x" → "20x". Returns null when no tier is encoded.
 */
function extractTierSuffix(rateLimitTier) {
    const match = /_(\d+x)$/i.exec(rateLimitTier);
    return match ? match[1] : null;
}
/**
 * Derives auth info from the parsed contents of {CLAUDE_CONFIG_DIR}.json.
 * Pure so it can be tested without touching the filesystem.
 */
export function deriveAuthInfo(claudeJson, env = process.env) {
    // ANTHROPIC_API_KEY takes precedence at runtime. oauthAccount can remain in
    // claude.json after a user switches to API-key authentication.
    if (hasApiKey(env)) {
        return API_KEY_AUTH_INFO;
    }
    const root = (claudeJson && typeof claudeJson === 'object')
        ? claudeJson
        : null;
    const account = (root?.oauthAccount && typeof root.oauthAccount === 'object')
        ? root.oauthAccount
        : null;
    if (!account) {
        return EMPTY_AUTH_INFO;
    }
    let method = null;
    const orgType = readString(account, 'organizationType');
    if (orgType) {
        method = formatOrgType(orgType);
        const rateLimitTier = readString(account, 'organizationRateLimitTier');
        const tier = rateLimitTier ? extractTierSuffix(rateLimitTier) : null;
        if (tier && !method.toLowerCase().includes(tier.toLowerCase())) {
            method += ` ${tier}`;
        }
    }
    const email = readString(account, 'emailAddress');
    const user = email ? email.split('@')[0] : readString(account, 'displayName');
    return { method, user };
}
const authCache = new FileCache({
    name: 'auth-cache',
    validate: (d) => d != null && typeof d === 'object'
        && typeof d.mtimeMs === 'number'
        && typeof d.size === 'number',
});
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
export function readAuthInfo() {
    // Avoid reading a stale OAuth profile when the active source is an API key.
    if (hasApiKey(process.env)) {
        return API_KEY_AUTH_INFO;
    }
    const homeDir = os.homedir();
    const configJsonPath = getClaudeConfigJsonPath(homeDir);
    let stat;
    try {
        stat = fs.statSync(configJsonPath);
    }
    catch {
        return EMPTY_AUTH_INFO;
    }
    const cached = authCache.read(homeDir);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return { method: cached.method, user: cached.user };
    }
    try {
        const content = fs.readFileSync(configJsonPath, 'utf-8');
        const info = deriveAuthInfo(JSON.parse(content));
        authCache.write(homeDir, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            method: info.method,
            user: info.user,
        });
        return info;
    }
    catch {
        return EMPTY_AUTH_INFO;
    }
}
export function truncateUser(user, maxLength) {
    if (maxLength <= 0 || user.length <= maxLength) {
        return user;
    }
    return `${user.slice(0, maxLength)}…`;
}
/**
 * Builds the standalone auth segment for the end of the first HUD line,
 * honoring the showAuth / showAuthUser / authUserLength display settings.
 * Returns e.g. "Claude Max 20x · yukinosh…", or null when nothing to show.
 */
export function formatAuthSegment(info, display) {
    if (!info) {
        return null;
    }
    const parts = [];
    if (display?.showAuth && info.method) {
        parts.push(info.method);
    }
    if (display?.showAuthUser && info.user) {
        parts.push(truncateUser(info.user, display?.authUserLength ?? 8));
    }
    return parts.length > 0 ? parts.join(' · ') : null;
}
//# sourceMappingURL=auth.js.map