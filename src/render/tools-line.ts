import type { RenderContext } from '../types.js';
import { yellow, green, cyan, dim } from './colors.js';

export function renderToolsLine(ctx: RenderContext): string | null {
  const { tools } = ctx.transcript;

  const runningTools = tools.filter((t) => t.status === 'running');

  if (runningTools.length === 0) {
    return null;
  }

  const ascii = ctx.config?.display?.asciiMode ?? false;
  const symRunning = ascii ? '~' : '◐';

  const parts: string[] = [];

  for (const tool of runningTools.slice(-3)) {
    const target = tool.target ? truncatePath(tool.target) : '';
    const elapsed = Date.now() - tool.startTime.getTime();
    const elapsedStr = elapsed > 5000 ? ` ${dim(`(${formatElapsed(elapsed)})`)}` : '';
    parts.push(`${yellow(symRunning)} ${cyan(tool.name)}${target ? dim(`: ${target}`) : ''}${elapsedStr}`);
  }

  if (runningTools.length > 3) {
    parts.push(dim(`+${runningTools.length - 3} more`));
  }

  return parts.join(' | ');
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '<1s';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function truncatePath(path: string, maxLen: number = 20): string {
  // Normalize Windows backslashes to forward slashes for consistent display
  const normalizedPath = path.replace(/\\/g, '/');

  if (normalizedPath.length <= maxLen) return normalizedPath;

  // Split by forward slash (already normalized)
  const parts = normalizedPath.split('/');
  const filename = parts.pop() || normalizedPath;

  if (filename.length >= maxLen) {
    return filename.slice(0, maxLen - 3) + '...';
  }

  return '.../' + filename;
}
