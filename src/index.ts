import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs } from './config-reader.js';
import { getGitStatus } from './git.js';
import { getUsage } from './usage-api.js';
import { loadConfig } from './config.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import { getContextVelocity } from './context-velocity.js';
import type { RenderContext } from './types.js';
import type { CumulativeTokenUsage } from './pricing.js';
import { calculateCost } from './pricing.js';
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
        ? deps.getUsage({
            ttls: {
              cacheTtlMs: config.usage.cacheTtlSeconds * 1000,
              failureCacheTtlMs: config.usage.failureCacheTtlSeconds * 1000,
            },
          })
        : Promise.resolve(null),
    ]);

    const { claudeMdCount, rulesCount, mcpCount, hooksCount } = configCounts;

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    const sessionDuration = formatSessionDuration(transcript.sessionStart, deps.now);

    const contextVelocity = getContextVelocity(stdin);

    // Compute cost estimation
    let costData: CumulativeTokenUsage | null = null;
    if (config.display.showCost !== false) {
      const usage = stdin.context_window?.current_usage;
      if (usage) {
        const modelId = stdin.model?.id ?? stdin.model?.display_name ?? 'opus';
        const tokens: CumulativeTokenUsage = {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          totalCost: 0,
          byModel: [{ model: modelId, inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0, cacheReadTokens: usage.cache_read_input_tokens ?? 0 }],
        };
        const estimate = calculateCost(tokens);
        tokens.totalCost = estimate.totalCost;
        costData = tokens;
      }
    }

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
