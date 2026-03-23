import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { StdinData } from './types.js';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';

const SPEED_WINDOW_MS = 2000;

interface SpeedCache {
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

export interface TokenSpeed {
  input: number | null;
  output: number | null;
}

export type SpeedTrackerDeps = {
  homeDir: () => string;
  now: () => number;
};

const defaultDeps: SpeedTrackerDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.speed-cache.json');
}

function readCache(homeDir: string): SpeedCache | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content) as SpeedCache;
    if (typeof parsed.outputTokens !== 'number' || typeof parsed.timestamp !== 'number' || typeof parsed.inputTokens !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, cache: SpeedCache): void {
  try {
    const cachePath = getCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    atomicWriteFileSync(cachePath, JSON.stringify(cache));
  } catch {
    // Ignore cache write failures
  }
}

export function getOutputSpeed(stdin: StdinData, overrides: Partial<SpeedTrackerDeps> = {}): number | null {
  const result = getTokenSpeed(stdin, overrides);
  return result?.output ?? null;
}

export function getTokenSpeed(stdin: StdinData, overrides: Partial<SpeedTrackerDeps> = {}): TokenSpeed | null {
  // Prefer cumulative totals (never drop on compaction) over current_usage (context window, drops)
  const cw = stdin.context_window;
  const outputTokens = cw?.total_output_tokens ?? cw?.current_usage?.output_tokens;
  const inputTokens = cw?.total_input_tokens ?? cw?.current_usage?.input_tokens;
  if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens)) {
    return null;
  }
  const safeInput = (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) ? inputTokens : 0;

  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();
  const previous = readCache(homeDir);

  let inputSpeed: number | null = null;
  let outputSpeed: number | null = null;

  if (previous) {
    const deltaMs = now - previous.timestamp;
    if (deltaMs > 0 && deltaMs <= SPEED_WINDOW_MS) {
      const deltaOutput = outputTokens - previous.outputTokens;
      if (deltaOutput > 0) {
        outputSpeed = deltaOutput / (deltaMs / 1000);
      }
      const deltaInput = safeInput - previous.inputTokens;
      if (deltaInput > 0) {
        inputSpeed = deltaInput / (deltaMs / 1000);
      }
    }
  }

  writeCache(homeDir, { inputTokens: safeInput, outputTokens, timestamp: now });
  return { input: inputSpeed, output: outputSpeed };
}
