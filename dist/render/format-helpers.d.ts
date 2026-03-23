import type { RenderContext } from '../types.js';
export declare function formatTokens(n: number): string;
export declare function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining' | 'usable'): string;
export declare function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string;
export declare function formatUsageError(error?: string): string;
export declare function formatResetTime(resetAt: Date | null): string;
//# sourceMappingURL=format-helpers.d.ts.map