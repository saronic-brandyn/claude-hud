import type { RenderContext } from '../types.js';
import { yellow, green, cyan, dim } from './colors.js';

export function renderToolsLine(ctx: RenderContext): string | null {
  const { tools } = ctx.transcript;

  if (tools.length === 0) {
    return null;
  }

  const ascii = ctx.config?.display?.asciiMode ?? false;
  const symRunning = ascii ? '~' : '◐';
  const symDone = ascii ? '+' : '✓';

  const parts: string[] = [];

  const runningTools = tools.filter((t) => t.status === 'running');
  const completedTools = tools.filter((t) => t.status === 'completed' || t.status === 'error');

  for (const tool of runningTools.slice(-2)) {
    const target = tool.target ? truncatePath(tool.target) : '';
    const elapsed = Date.now() - tool.startTime.getTime();
    const elapsedStr = elapsed > 5000 ? ` ${dim(`(${formatElapsed(elapsed)})`)}` : '';
    parts.push(`${yellow(symRunning)} ${cyan(tool.name)}${target ? dim(`: ${target}`) : ''}${elapsedStr}`);
  }

  const toolCounts = new Map<string, number>();
  for (const tool of completedTools) {
    const count = toolCounts.get(tool.name) ?? 0;
    toolCounts.set(tool.name, count + 1);
  }

  const sortedTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  for (const [name, count] of sortedTools) {
    parts.push(`${green(symDone)} ${name} ${dim(`×${count}`)}`);
  }

  if (parts.length === 0) {
    return null;
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
