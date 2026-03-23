import type { StdinData } from './types.js';
export type VelocityDeps = {
    homeDir: () => string;
    now: () => number;
};
/**
 * Calculate context token velocity in tokens/minute.
 * Returns null if insufficient data or velocity below display threshold.
 */
export interface VelocityResult {
    velocity: number | null;
    delta: number | null;
}
export declare function getContextVelocity(stdin: StdinData, overrides?: Partial<VelocityDeps>): VelocityResult;
//# sourceMappingURL=context-velocity.d.ts.map