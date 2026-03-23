import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs } from './config-reader.js';
import { getGitStatus } from './git.js';
import { getUsage } from './usage-api.js';
import { loadConfig } from './config.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import { getContextVelocity } from './context-velocity.js';
import { detectCompaction } from './compaction-detector.js';
import { getContextPercent, getBufferedPercent } from './stdin.js';
import type { RenderContext, StdinData, UsageData } from './types.js';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export type MainDeps = {
  readStdin: typeof readStdin;
  parseTranscript: typeof parseTranscript;
  countConfigs: typeof countConfigs;
  getGitStatus: typeof getGitStatus;
  getUsage: typeof getUsage;
  loadConfig: typeof loadConfig;
  parseExtraCmdArg: typeof parseExtraCmdArg;
  runExtraCmd: typeof runExtraCmd;
  render: typeof render;
  now: () => number;
  log: (...args: unknown[]) => void;
};


function formatDurationMs(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

function parseNativeRateLimits(stdin: StdinData): UsageData | null {
  const rl = stdin.rate_limits;
  if (!rl?.five_hour && !rl?.seven_day) return null;

  const fiveHour = typeof rl.five_hour?.used_percentage === 'number'
    ? Math.round(Math.max(0, Math.min(100, rl.five_hour.used_percentage)))
    : null;
  const sevenDay = typeof rl.seven_day?.used_percentage === 'number'
    ? Math.round(Math.max(0, Math.min(100, rl.seven_day.used_percentage)))
    : null;

  const fiveHourResetAt = rl.five_hour?.resets_at ? new Date(rl.five_hour.resets_at) : null;
  const sevenDayResetAt = rl.seven_day?.resets_at ? new Date(rl.seven_day.resets_at) : null;

  if (fiveHourResetAt && isNaN(fiveHourResetAt.getTime())) return null;
  if (sevenDayResetAt && isNaN(sevenDayResetAt.getTime())) return null;

  return { planName: null, fiveHour, sevenDay, fiveHourResetAt, sevenDayResetAt };
}

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  const deps: MainDeps = {
    readStdin,
    parseTranscript,
    countConfigs,
    getGitStatus,
    getUsage,
    loadConfig,
    parseExtraCmdArg,
    runExtraCmd,
    render,
    now: () => Date.now(),
    log: console.log,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();

    if (!stdin) {
      // Running without stdin - this happens during setup verification
      const isMacOS = process.platform === 'darwin';
      deps.log('[claude-hud] Initializing...');
      if (isMacOS) {
        deps.log('[claude-hud] Note: On macOS, you may need to restart Claude Code for the HUD to appear.');
      }
      return;
    }

    const transcriptPath = stdin.transcript_path ?? '';

    const config = await deps.loadConfig();

    const [transcript, configCounts, gitStatus, usageData] = await Promise.all([
      deps.parseTranscript(transcriptPath),
      deps.countConfigs(stdin.cwd),
      config.gitStatus.enabled
        ? deps.getGitStatus(stdin.cwd)
        : Promise.resolve(null),
      config.display.showUsage !== false
        ? (async () => {
            const native = parseNativeRateLimits(stdin);
            if (native) {
              // Native rate_limits lack planName — try to read from credentials
              const creds = await deps.getUsage({
                ttls: { cacheTtlMs: 300_000, failureCacheTtlMs: 60_000 },
              });
              if (creds?.planName) {
                native.planName = creds.planName;
              }
              return native;
            }
            return deps.getUsage({
              ttls: {
                cacheTtlMs: config.usage.cacheTtlSeconds * 1000,
                failureCacheTtlMs: config.usage.failureCacheTtlSeconds * 1000,
              },
            });
          })()
        : Promise.resolve(null),
    ]);

    const { claudeMdCount, rulesCount, mcpCount, hooksCount } = configCounts;

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    // Prefer native duration from stdin (exact), fall back to transcript timestamp
    const nativeDurationMs = stdin.cost?.total_duration_ms;
    const sessionDuration = nativeDurationMs && nativeDurationMs > 0
      ? formatDurationMs(nativeDurationMs)
      : formatSessionDuration(transcript.sessionStart, deps.now);

    const contextVelocity = getContextVelocity(stdin);

    const autocompactMode = config.display?.autocompactBuffer ?? 'enabled';
    const percent = autocompactMode === 'disabled'
      ? getContextPercent(stdin)
      : getBufferedPercent(stdin);
    const compactionEvent = detectCompaction(percent);

    // Use native cost data from stdin (Claude Code provides exact cumulative cost)
    const costData = (config.display.showCost !== false && stdin.cost) ? stdin.cost : null;

    const ctx: RenderContext = {
      stdin,
      transcript,
      claudeMdCount,
      rulesCount,
      mcpCount,
      hooksCount,
      sessionDuration,
      gitStatus,
      usageData,
      config,
      extraLabel,
      contextVelocity,
      compactionEvent,
      costData,
    };

    deps.render(ctx);
  } catch (error) {
    deps.log('[claude-hud] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

export function formatSessionDuration(sessionStart?: Date, now: () => number = () => Date.now()): string {
  if (!sessionStart) {
    return '';
  }

  const ms = now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
  void main();
}
