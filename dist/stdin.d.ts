import type { StdinData } from './types.js';
type StdinStream = Pick<NodeJS.ReadStream, 'setEncoding' | 'on' | 'off' | 'pause'> & {
    isTTY?: boolean;
};
type ReadStdinOptions = {
    firstByteTimeoutMs?: number;
    idleTimeoutMs?: number;
    maxBytes?: number;
};
export declare function readStdin(stream?: StdinStream, options?: ReadStdinOptions): Promise<StdinData | null>;
export declare function getTotalTokens(stdin: StdinData): number;
export declare function getContextPercent(stdin: StdinData): number;
export declare function getBufferedPercent(stdin: StdinData): number;
/**
 * Strips redundant context-window size suffixes from model display names.
 *
 * Claude Code may include the context window size in the display name
 * (e.g. "Opus 4.6 (1M context)"), but the HUD already shows context
 * usage via the context bar — so the parenthetical is redundant.
 *
 * Handles common variants:
 *   "Opus 4.6 (1M context)"         → "Opus 4.6"
 *   "Sonnet 4 (200k context)"       → "Sonnet 4"
 *   "Claude 3.5 (with 1M context)"  → "Claude 3.5"
 */
export declare function stripContextSuffix(name: string): string;
export declare function getModelName(stdin: StdinData): string;
export declare function isBedrockModelId(modelId?: string): boolean;
export declare function getProviderLabel(stdin: StdinData): string | null;
export {};
//# sourceMappingURL=stdin.d.ts.map