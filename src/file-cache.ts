import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { atomicWriteFileSync } from './atomic-write.js';

export interface FileCacheOptions<T> {
  /** Base filename without extension (e.g., 'cost-cache') */
  name: string;
  /** Validate that parsed JSON has the expected shape */
  validate: (data: unknown) => data is T;
}

/**
 * Generic file-based cache for persisting state across ~300ms statusline invocations.
 * Supports session isolation when a session_id is provided.
 */
export class FileCache<T> {
  private readonly name: string;
  private readonly validate: (data: unknown) => data is T;

  constructor(options: FileCacheOptions<T>) {
    this.name = options.name;
    this.validate = options.validate;
  }

  /** Build cache file path, optionally scoped to a session */
  private getPath(homeDir: string, sessionId?: string): string {
    const dir = getHudPluginDir(homeDir);
    const suffix = sessionId ? `.${sessionId.slice(0, 12)}` : '';
    return path.join(dir, `.${this.name}${suffix}.json`);
  }

  read(homeDir: string, sessionId?: string): T | null {
    try {
      const cachePath = this.getPath(homeDir, sessionId);
      if (!fs.existsSync(cachePath)) return null;
      const content = fs.readFileSync(cachePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (!this.validate(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  write(homeDir: string, data: T, sessionId?: string): void {
    try {
      const cachePath = this.getPath(homeDir, sessionId);
      const cacheDir = path.dirname(cachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      atomicWriteFileSync(cachePath, JSON.stringify(data));
    } catch {
      // Ignore cache write failures — statusline must not crash
    }
  }
}
