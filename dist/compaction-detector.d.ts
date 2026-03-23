export interface CompactionEvent {
    state: 'approaching' | 'compacted';
    delta?: number;
    age: number;
}
export type CompactionDeps = {
    homeDir: () => string;
    now: () => number;
};
/**
 * Detect context compaction events by tracking percentage drops.
 * Returns a CompactionEvent if a recent compaction was detected (within INDICATOR_DURATION_MS).
 */
export declare function detectCompaction(currentPercent: number, overrides?: Partial<CompactionDeps>): CompactionEvent | null;
//# sourceMappingURL=compaction-detector.d.ts.map