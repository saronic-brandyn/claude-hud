import { readStdin, getUsageFromStdin, getContextPercent } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus } from "./git.js";
import { getJjStatus, isJjRepo } from "./jj.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { resolveEffortLevel } from "./effort.js";
import { detectBackendProfile } from "./backend.js";
import { detectCompaction } from "./compaction-detector.js";
import { getContextVelocity } from "./context-velocity.js";
import { getQueryCost } from "./query-cost.js";
import { getActionCosts } from "./action-cost.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { setLanguage, t } from "./i18n/index.js";
import type { RenderContext } from "./types.js";
import type { GitStatus } from "./git.js";
import type { HudConfig } from "./config.js";

export { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";

export type MainDeps = {
  readStdin: typeof readStdin;
  getUsageFromStdin: typeof getUsageFromStdin;
  getUsageFromExternalSnapshot: typeof getUsageFromExternalSnapshot;
  writeExternalUsageSnapshot: typeof writeExternalUsageSnapshot;
  parseTranscript: typeof parseTranscript;
  countConfigs: typeof countConfigs;
  getGitStatus: typeof getGitStatus;
  getJjStatus: typeof getJjStatus;
  isJjRepo: typeof isJjRepo;
  loadConfig: typeof loadConfig;
  parseExtraCmdArg: typeof parseExtraCmdArg;
  runExtraCmd: typeof runExtraCmd;
  getClaudeCodeVersion: typeof getClaudeCodeVersion;
  getMemoryUsage: typeof getMemoryUsage;
  readAuthInfo: typeof readAuthInfo;
  applyContextWindowFallback: typeof applyContextWindowFallback;
  render: typeof render;
  now: () => number;
  log: (...args: unknown[]) => void;
};

/**
 * Returns true when the HUD is disabled for this invocation via the
 * CLAUDE_HUD_DISABLE environment variable. Any non-blank value other than an
 * explicit negative (`0`, `false`, `off`, `no`, case-insensitive) disables the
 * HUD, so users can launch sessions without it (`CLAUDE_HUD_DISABLE=1 claude`)
 * while keeping the statusLine entry in settings.json intact.
 */
export function isHudDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return false;
  }
  return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

/**
 * Prefers jj when an eligible `.jj` marker is found and the opt-in is enabled.
 * If the bounded jj probe fails, Git remains the safe compatibility fallback.
 */
export async function resolveVcsStatus(
  deps: Pick<MainDeps, "getGitStatus" | "getJjStatus" | "isJjRepo">,
  config: HudConfig,
  cwd?: string,
): Promise<GitStatus | null> {
  if (!cwd) return null;
  if (config.jjStatus.enabled && deps.isJjRepo(cwd)) {
    const jjStatus = await deps.getJjStatus(cwd);
    if (jjStatus) return jjStatus;
  }
  if (config.gitStatus.enabled) {
    return deps.getGitStatus(cwd);
  }
  return null;
}

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  if (isHudDisabled()) {
    // Print nothing so Claude Code renders an empty statusline, and skip all
    // work (stdin parse, transcript scan, git) on each event-driven refresh.
    return;
  }

  const deps: MainDeps = {
    readStdin,
    getUsageFromStdin,
    getUsageFromExternalSnapshot,
    writeExternalUsageSnapshot,
    parseTranscript,
    countConfigs,
    getGitStatus,
    getJjStatus,
    isJjRepo,
    loadConfig,
    parseExtraCmdArg,
    runExtraCmd,
    getClaudeCodeVersion,
    getMemoryUsage,
    readAuthInfo,
    applyContextWindowFallback,
    render,
    now: () => Date.now(),
    log: console.log,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();

    if (!stdin) {
      // Running without stdin - this happens during setup verification
      const config = await deps.loadConfig();
      setLanguage(config.language);
      const isMacOS = process.platform === "darwin";
      deps.log(t("init.initializing"));
      if (isMacOS) {
        deps.log(t("init.macosNote"));
      }
      return;
    }

    const transcriptPath = stdin.transcript_path ?? "";
    const transcript = await deps.parseTranscript(transcriptPath);

    deps.applyContextWindowFallback(stdin, {}, transcript.sessionName, {
      lastCompactBoundaryAt: transcript.lastCompactBoundaryAt,
      lastCompactPostTokens: transcript.lastCompactPostTokens,
    });

    const { claudeMdCount, rulesCount, mcpCount, hooksCount, outputStyle } =
      await deps.countConfigs(stdin.cwd);

    const config = await deps.loadConfig();
    setLanguage(config.language);
    const gitStatus = await resolveVcsStatus(deps, config, stdin.cwd);

    let usageData: RenderContext["usageData"] = null;
    const shouldReadUsage = config.display.showUsage !== false;
    const shouldWriteUsage = Boolean(config.display.externalUsageWritePath);
    const stdinUsage = shouldReadUsage || shouldWriteUsage
      ? deps.getUsageFromStdin(stdin)
      : null;

    if (shouldWriteUsage && stdinUsage) {
      deps.writeExternalUsageSnapshot(config, stdinUsage, deps.now());
    }

    if (shouldReadUsage) {
      usageData = stdinUsage;
      if (!usageData) {
        usageData = deps.getUsageFromExternalSnapshot(config, deps.now());
      } else if (config.display.externalUsagePath) {
        const ext = deps.getUsageFromExternalSnapshot(config, deps.now());
        if (ext != null) {
          usageData = {
            ...usageData,
            ...(ext.balanceLabel != null && { balanceLabel: ext.balanceLabel }),
            // If stdin did not provide sevenDay (e.g. third-party clients like the
            // Claudian Obsidian plugin that only surface five_hour), fall back to the
            // external snapshot so the weekly limit still shows in the HUD.
            ...(usageData.sevenDay == null && ext.sevenDay != null && {
              sevenDay: ext.sevenDay,
              sevenDayResetAt: ext.sevenDayResetAt ?? null,
            }),
          };
        }
      }
    }

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    const sessionDuration = formatSessionDuration(
      transcript.sessionStart,
      deps.now,
    );
    const claudeCodeVersion = config.display.showClaudeCodeVersion
      ? await deps.getClaudeCodeVersion()
      : undefined;
    const effortInfo = config.display.showEffortLevel
      ? resolveEffortLevel(stdin.effort, { ultracodeActive: transcript.ultracodeActive })
      : null;
    const memoryUsage =
      config.display.showMemoryUsage && config.lineLayout === "expanded"
        ? await deps.getMemoryUsage()
        : null;
    const authInfo =
      config.display.showAuth || config.display.showAuthUser
        ? deps.readAuthInfo()
        : null;

    // Launch-profile detection, resolved in two passes so that a DISPLAY toggle
    // never governs a DETECTION input.
    //
    // Pass 1 needs no auth at all: an explicit CLAUDE_HUD_PROFILE override, and
    // Bedrock/GovCloud, are decidable from stdin + env alone. Most sessions end
    // here and pay no extra I/O.
    //
    // Pass 2 runs ONLY when pass 1 is `unknown` — the non-Bedrock case, where
    // separating a subscription from a workspace key needs an auth signal. It
    // reuses authInfo when the auth display already loaded it, and otherwise
    // reads it on purpose. Previously this input was taken from the
    // showAuth/showAuthUser display flags, so turning the auth text OFF also
    // silently disabled profile detection — a surprising coupling with no
    // indication of why the label vanished.
    //
    // ANTHROPIC_API_KEY is scrubbed from the status-line subprocess, so when
    // neither signal is present detectBackendProfile still returns `unknown`
    // and the renderer falls back to the provider label rather than guessing.
    let backendProfile = detectBackendProfile(stdin);
    if (backendProfile === "unknown") {
      const profileAuth = authInfo ?? deps.readAuthInfo();
      backendProfile = detectBackendProfile(stdin, {
        hasSubscription: !!profileAuth?.method && profileAuth.method !== "API Key",
        hasApiKey: profileAuth?.method === "API Key",
      });
    }

    // Compaction state and token velocity are both derived by comparing this
    // tick against the previous one, so they are stateful across invocations
    // (FileCache) and must be computed exactly once per run.
    //
    // Session key follows context-cache.ts: a sha256 of the transcript path.
    // The fork previously read stdin.session_id, which upstream's StdinData
    // does not model; hashing the transcript path keys the same thing without
    // asserting an unmodelled field, and keeps concurrent sessions isolated.
    const sessionKey = stdin.transcript_path
      ? createHash("sha256").update(stdin.transcript_path).digest("hex")
      : undefined;
    const compaction = config.display.showCompactionState !== false
      ? detectCompaction(getContextPercent(stdin), { sessionId: sessionKey })
      : null;
    const contextDelta = config.display.showContextDelta === true
      ? getContextVelocity(stdin, { sessionId: sessionKey }).delta
      : null;
    const queryCost = config.display.showQueryCost === true
      ? getQueryCost(stdin.cost?.total_cost_usd ?? undefined, { sessionId: sessionKey })
      : null;
    const actionCosts = config.display.showCostByAction === true
      ? getActionCosts(
          stdin.cost?.total_cost_usd ?? undefined,
          transcript.tools,
          transcript.agents,
          config.display.costByActionThreshold,
          sessionKey,
        )
      : null;

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
      memoryUsage,
      config,
      extraLabel,
      outputStyle,
      claudeCodeVersion,
      effortLevel: effortInfo?.level,
      effortSymbol: effortInfo?.symbol,
      authInfo,
      backendProfile,
      compaction,
      contextDelta,
      queryCost,
      actionCosts,
    };

    deps.render(ctx);
  } catch (error) {
    deps.log(
      "[claude-hud] Error:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

export function formatSessionDuration(
  sessionStart?: Date,
  now: () => number = () => Date.now(),
): string {
  if (!sessionStart) {
    return "";
  }

  const ms = now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return "<1m";
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
