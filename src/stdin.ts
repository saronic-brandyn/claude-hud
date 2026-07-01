import type { StdinData } from './types.js';
import { AUTOCOMPACT_BUFFER_PERCENT } from './constants.js';

type StdinStream = Pick<NodeJS.ReadStream, 'setEncoding' | 'on' | 'off' | 'pause'> & {
  isTTY?: boolean;
};

type ReadStdinOptions = {
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxBytes?: number;
};

const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 250;
const DEFAULT_IDLE_TIMEOUT_MS = 30;
const DEFAULT_MAX_STDIN_BYTES = 256 * 1024;

export async function readStdin(
  stream: StdinStream = process.stdin,
  options: ReadStdinOptions = {},
): Promise<StdinData | null> {
  if (stream.isTTY) {
    return null;
  }

  const firstByteTimeoutMs = options.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_STDIN_BYTES;

  try {
    stream.setEncoding('utf8');
  } catch {
    return null;
  }

  return await new Promise<StdinData | null>((resolve) => {
    let raw = '';
    let settled = false;
    let sawData = false;
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        firstByteTimer = undefined;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.pause();
    };

    const finish = (value: StdinData | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const tryParse = (): StdinData | null | undefined => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return null;
      }

      try {
        return JSON.parse(trimmed) as StdinData;
      } catch {
        return undefined;
      }
    };

    const scheduleIdleParse = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        const parsed = tryParse();
        finish(parsed ?? null);
      }, idleTimeoutMs);
    };

    const onData = (chunk: string | Buffer): void => {
      sawData = true;
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        firstByteTimer = undefined;
      }

      raw += String(chunk);
      if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        finish(null);
        return;
      }

      const parsed = tryParse();
      if (parsed !== undefined) {
        finish(parsed);
        return;
      }

      scheduleIdleParse();
    };

    const onEnd = (): void => {
      const parsed = tryParse();
      finish(parsed ?? null);
    };

    const onError = (): void => {
      finish(null);
    };

    firstByteTimer = setTimeout(() => {
      if (!sawData) {
        finish(null);
      }
    }, firstByteTimeoutMs);

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

export function getTotalTokens(stdin: StdinData): number {
  const usage = stdin.context_window?.current_usage;
  return (
    (usage?.input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0)
  );
}

/**
 * Get native percentage from Claude Code v2.1.6+ if available.
 * Returns null if not available or invalid, triggering fallback to manual calculation.
 */
function getNativePercent(stdin: StdinData): number | null {
  const nativePercent = stdin.context_window?.used_percentage;
  if (typeof nativePercent === 'number' && !Number.isNaN(nativePercent)) {
    return Math.min(100, Math.max(0, Math.round(nativePercent)));
  }
  return null;
}

/**
 * Standard Claude context-window tiers, ascending. Every Claude model ships
 * with either a 200K or a 1M window — there is no other size. Used to recover
 * the true window when Claude Code under-reports it (below).
 */
const STANDARD_CONTEXT_WINDOWS = [200_000, 1_000_000];

/**
 * True if Claude Code's reported context_window_size is provably wrong because
 * current usage already exceeds it. No real deployment serves more tokens than
 * its window, so `used > reported` means the reported size is stale/incorrect.
 *
 * Observed on Bedrock/GovCloud model IDs (e.g. `us-gov.anthropic.claude-opus-4-8`)
 * that Claude Code's model registry doesn't recognize as 1M, so it falls back to
 * the 200K default — a 440K session then renders as a clamped 100%.
 */
function isWindowUnderReported(stdin: StdinData): boolean {
  const reported = stdin.context_window?.context_window_size ?? 0;
  return reported > 0 && getTotalTokens(stdin) > reported;
}

/**
 * Effective context-window size, correcting a proven Claude Code under-report.
 * Only ever corrects UPWARD, and only when the token count itself contradicts
 * the reported size — so it can never mask a genuine cap (e.g. a 1M-capable
 * model deployed with a 200K limit is left untouched until usage disproves it).
 * Model-agnostic: no per-model table to fall out of date.
 */
export function getEffectiveContextWindowSize(stdin: StdinData): number {
  const reported = stdin.context_window?.context_window_size ?? 0;
  const used = getTotalTokens(stdin);
  if (!isWindowUnderReported(stdin)) {
    return reported; // reported size is present and consistent with usage
  }
  // Reported size is contradicted by usage — snap up to the smallest standard
  // tier that actually fits (in practice 1M); if usage somehow exceeds every
  // known tier, fall back to usage itself so the bar reads an honest 100%.
  const tier = STANDARD_CONTEXT_WINDOWS.find((w) => w >= used);
  return tier ?? used;
}

export function getContextPercent(stdin: StdinData): number {
  // Prefer native percentage (v2.1.6+) — accurate and matches /context — UNLESS
  // it's derived from a context_window_size the token count disproves, in which
  // case the native percentage is itself wrong (a clamped 100%).
  if (!isWindowUnderReported(stdin)) {
    const native = getNativePercent(stdin);
    if (native !== null) {
      return native;
    }
  }

  // Manual calculation against the effective (under-report-corrected) size.
  const size = getEffectiveContextWindowSize(stdin);
  if (!size || size <= 0) {
    return 0;
  }

  const totalTokens = getTotalTokens(stdin);
  return Math.min(100, Math.round((totalTokens / size) * 100));
}

export function getBufferedPercent(stdin: StdinData): number {
  // Prefer native percentage (v2.1.6+) so the HUD matches Claude Code's own
  // context output — unless the reported window is under-reported (see above).
  if (!isWindowUnderReported(stdin)) {
    const native = getNativePercent(stdin);
    if (native !== null) {
      return native;
    }
  }

  // Manual calculation with buffer against the effective (corrected) size.
  const size = getEffectiveContextWindowSize(stdin);
  if (!size || size <= 0) {
    return 0;
  }

  const totalTokens = getTotalTokens(stdin);

  // Scale buffer by raw usage: no buffer at ≤5% (e.g. after /clear),
  // full buffer at ≥50%. Autocompact doesn't kick in at very low usage.
  const rawRatio = totalTokens / size;
  const LOW = 0.05;
  const HIGH = 0.50;
  const scale = Math.min(1, Math.max(0, (rawRatio - LOW) / (HIGH - LOW)));
  const buffer = size * AUTOCOMPACT_BUFFER_PERCENT * scale;

  return Math.min(100, Math.round(((totalTokens + buffer) / size) * 100));
}

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
export function stripContextSuffix(name: string): string {
  return name.replace(/\s*\([^)]*\bcontext\b[^)]*\)/i, '').trim();
}

export function getModelName(stdin: StdinData): string {
  const displayName = stdin.model?.display_name?.trim();
  if (displayName) {
    return stripContextSuffix(displayName);
  }

  const modelId = stdin.model?.id?.trim();
  if (!modelId) {
    return 'Unknown';
  }

  const normalizedBedrockLabel = normalizeBedrockModelLabel(modelId);
  return normalizedBedrockLabel ?? modelId;
}

export function isBedrockModelId(modelId?: string): boolean {
  if (!modelId) {
    return false;
  }
  const normalized = modelId.toLowerCase();
  return normalized.includes('anthropic.claude-');
}

export function getProviderLabel(stdin: StdinData): string | null {
  if (isBedrockModelId(stdin.model?.id)) {
    return 'Bedrock';
  }
  return null;
}

function normalizeBedrockModelLabel(modelId: string): string | null {
  if (!isBedrockModelId(modelId)) {
    return null;
  }

  const lowercaseId = modelId.toLowerCase();
  const claudePrefix = 'anthropic.claude-';
  const claudeIndex = lowercaseId.indexOf(claudePrefix);
  if (claudeIndex === -1) {
    return null;
  }

  let suffix = lowercaseId.slice(claudeIndex + claudePrefix.length);
  suffix = suffix.replace(/-v\d+:\d+$/, '');
  suffix = suffix.replace(/-\d{8}$/, '');

  const tokens = suffix.split('-').filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const familyIndex = tokens.findIndex((token) => token === 'haiku' || token === 'sonnet' || token === 'opus');
  if (familyIndex === -1) {
    return null;
  }

  const family = tokens[familyIndex];
  const beforeVersion = readNumericVersion(tokens, familyIndex - 1, -1).reverse();
  const afterVersion = readNumericVersion(tokens, familyIndex + 1, 1);
  const versionParts = beforeVersion.length >= afterVersion.length ? beforeVersion : afterVersion;
  const version = versionParts.length ? versionParts.join('.') : null;
  const familyLabel = family[0].toUpperCase() + family.slice(1);

  return version ? `Claude ${familyLabel} ${version}` : `Claude ${familyLabel}`;
}

function readNumericVersion(tokens: string[], startIndex: number, step: -1 | 1): string[] {
  const parts: string[] = [];
  for (let i = startIndex; i >= 0 && i < tokens.length; i += step) {
    if (!/^\d+$/.test(tokens[i])) {
      break;
    }
    parts.push(tokens[i]);
    if (parts.length === 2) {
      break;
    }
  }
  return parts;
}
