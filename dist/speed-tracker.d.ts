import type { StdinData } from './types.js';
export interface TokenSpeed {
    input: number | null;
    output: number | null;
}
export type SpeedTrackerDeps = {
    homeDir: () => string;
    now: () => number;
};
export declare function getOutputSpeed(stdin: StdinData, overrides?: Partial<SpeedTrackerDeps>): number | null;
export declare function getTokenSpeed(stdin: StdinData, overrides?: Partial<SpeedTrackerDeps>): TokenSpeed | null;
//# sourceMappingURL=speed-tracker.d.ts.map