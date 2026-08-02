import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';
import { createDebug } from './debug.js';
const debug = createDebug('file-cache');
/**
 * Caches live in their own subdirectory rather than the plugin root.
 *
 * Pre-v0.6.0 the fork wrote `.{name}.{session}.json` directly into
 * getHudPluginDir(). With one file per cache per session and no eviction, a
 * real host accumulated 1,317 cache files and 87 orphaned .tmp files. Scoping
 * to a subdirectory makes the set sweepable without touching sibling state.
 */
const CACHE_DIRNAME = 'hud-cache';
/**
 * Sweep parameters, matched to context-cache.ts so the two caches age out
 * on identical terms. A sweep runs probabilistically on write to keep the
 * directory scan off the ~300ms status-line hot path.
 */
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const SWEEP_SAMPLE_RATE = 0.01;
/**
 * A .tmp file is written and renamed within milliseconds, so any tmp older
 * than this was orphaned — the writer was killed between writeFileSync and
 * renameSync, which skips atomicWriteFileSync's catch-block cleanup entirely.
 * The status line is invoked every ~300ms and is routinely killed mid-tick,
 * so this is a steady drip, not an edge case.
 */
const MAX_TMP_AGE_MS = 5 * 60 * 1000;
const defaultDeps = {
    random: Math.random,
    now: Date.now,
};
/** Cache directory for a given home dir. Exported for tests. */
export function getCacheDir(homeDir) {
    return path.join(getHudPluginDir(homeDir), CACHE_DIRNAME);
}
/**
 * Remove aged-out cache entries, orphaned .tmp files, and enforce a hard cap
 * on total file count. Safe to run opportunistically; per-file failures are
 * swallowed so a sweep can never break the status line.
 */
function sweepCacheDir(cacheDir, now) {
    try {
        if (!fs.existsSync(cacheDir))
            return;
        const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
        const survivors = [];
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            const isTmp = entry.name.endsWith('.tmp');
            const isJson = entry.name.endsWith('.json');
            if (!isTmp && !isJson)
                continue;
            const fullPath = path.join(cacheDir, entry.name);
            try {
                const stat = fs.statSync(fullPath);
                const age = now - stat.mtimeMs;
                // Orphaned tmp files age out far faster than real entries, and never
                // count toward the survivor cap — they are debris, not cache.
                if (isTmp) {
                    if (age > MAX_TMP_AGE_MS)
                        fs.unlinkSync(fullPath);
                    continue;
                }
                if (age > MAX_CACHE_AGE_MS) {
                    fs.unlinkSync(fullPath);
                    continue;
                }
                survivors.push({ fullPath, mtimeMs: stat.mtimeMs });
            }
            catch (err) {
                debug('Sweep: failed to process %s:', fullPath, err instanceof Error ? err.message : err);
            }
        }
        if (survivors.length > MAX_CACHE_ENTRIES) {
            survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
            const toDelete = survivors.length - MAX_CACHE_ENTRIES;
            for (let i = 0; i < toDelete; i += 1) {
                try {
                    fs.unlinkSync(survivors[i].fullPath);
                }
                catch (err) {
                    debug('Sweep: failed to unlink %s:', survivors[i].fullPath, err instanceof Error ? err.message : err);
                }
            }
        }
    }
    catch (err) {
        debug('Cache sweep failed:', err instanceof Error ? err.message : err);
    }
}
/**
 * Generic file-based cache for persisting state across ~300ms statusline
 * invocations. Supports session isolation when a session_id is provided.
 *
 * Distinct from context-cache.ts, which is a purpose-built snapshot store for
 * context-window recovery. This is the generic key/value substrate used by
 * compaction-detector, context-velocity, query-cost and action-cost.
 */
export class FileCache {
    name;
    validate;
    deps;
    constructor(options, deps = {}) {
        this.name = options.name;
        this.validate = options.validate;
        this.deps = { ...defaultDeps, ...deps };
    }
    /** Build cache file path, optionally scoped to a session */
    getPath(homeDir, sessionId) {
        const suffix = sessionId ? `.${sessionId.slice(0, 12)}` : '';
        return path.join(getCacheDir(homeDir), `${this.name}${suffix}.json`);
    }
    read(homeDir, sessionId) {
        try {
            const cachePath = this.getPath(homeDir, sessionId);
            if (!fs.existsSync(cachePath))
                return null;
            const content = fs.readFileSync(cachePath, 'utf8');
            const parsed = JSON.parse(content);
            if (!this.validate(parsed))
                return null;
            return parsed;
        }
        catch {
            return null;
        }
    }
    write(homeDir, data, sessionId) {
        try {
            const cachePath = this.getPath(homeDir, sessionId);
            const cacheDir = path.dirname(cachePath);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            atomicWriteFileSync(cachePath, JSON.stringify(data));
            if (this.deps.random() < SWEEP_SAMPLE_RATE) {
                sweepCacheDir(cacheDir, this.deps.now());
            }
        }
        catch {
            // Ignore cache write failures — statusline must not crash
        }
    }
}
/** Test-only entrypoint for deterministically exercising the sweep logic. */
export function _sweepCacheForTests(homeDir, now) {
    sweepCacheDir(getCacheDir(homeDir), now);
}
//# sourceMappingURL=file-cache.js.map