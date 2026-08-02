export interface FileCacheOptions<T> {
    /** Base filename without extension (e.g., 'cost-cache') */
    name: string;
    /** Validate that parsed JSON has the expected shape */
    validate: (data: unknown) => data is T;
}
/** Injectable seams so tests can drive the sweep deterministically. */
export interface FileCacheDeps {
    random: () => number;
    now: () => number;
}
/** Cache directory for a given home dir. Exported for tests. */
export declare function getCacheDir(homeDir: string): string;
/**
 * Generic file-based cache for persisting state across ~300ms statusline
 * invocations. Supports session isolation when a session_id is provided.
 *
 * Distinct from context-cache.ts, which is a purpose-built snapshot store for
 * context-window recovery. This is the generic key/value substrate used by
 * compaction-detector, context-velocity, query-cost and action-cost.
 */
export declare class FileCache<T> {
    private readonly name;
    private readonly validate;
    private readonly deps;
    constructor(options: FileCacheOptions<T>, deps?: Partial<FileCacheDeps>);
    /** Build cache file path, optionally scoped to a session */
    private getPath;
    read(homeDir: string, sessionId?: string): T | null;
    write(homeDir: string, data: T, sessionId?: string): void;
}
/** Test-only entrypoint for deterministically exercising the sweep logic. */
export declare function _sweepCacheForTests(homeDir: string, now: number): void;
//# sourceMappingURL=file-cache.d.ts.map