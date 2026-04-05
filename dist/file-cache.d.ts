export interface FileCacheOptions<T> {
    /** Base filename without extension (e.g., 'cost-cache') */
    name: string;
    /** Validate that parsed JSON has the expected shape */
    validate: (data: unknown) => data is T;
}
/**
 * Generic file-based cache for persisting state across ~300ms statusline invocations.
 * Supports session isolation when a session_id is provided.
 */
export declare class FileCache<T> {
    private readonly name;
    private readonly validate;
    constructor(options: FileCacheOptions<T>);
    /** Build cache file path, optionally scoped to a session */
    private getPath;
    read(homeDir: string, sessionId?: string): T | null;
    write(homeDir: string, data: T, sessionId?: string): void;
}
//# sourceMappingURL=file-cache.d.ts.map