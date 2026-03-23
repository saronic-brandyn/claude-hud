/**
 * Write a file atomically via write-to-temp + rename.
 * Prevents corruption when multiple HUD processes write concurrently.
 */
export declare function atomicWriteFileSync(filePath: string, data: string): void;
//# sourceMappingURL=atomic-write.d.ts.map