import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';
/**
 * Generic file-based cache for persisting state across ~300ms statusline invocations.
 * Supports session isolation when a session_id is provided.
 */
export class FileCache {
    name;
    validate;
    constructor(options) {
        this.name = options.name;
        this.validate = options.validate;
    }
    /** Build cache file path, optionally scoped to a session */
    getPath(homeDir, sessionId) {
        const dir = getHudPluginDir(homeDir);
        const suffix = sessionId ? `.${sessionId.slice(0, 12)}` : '';
        return path.join(dir, `.${this.name}${suffix}.json`);
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
        }
        catch {
            // Ignore cache write failures — statusline must not crash
        }
    }
}
//# sourceMappingURL=file-cache.js.map