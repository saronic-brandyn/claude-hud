import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Write a file atomically via write-to-temp + rename.
 * Prevents corruption when multiple HUD processes write concurrently.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    fs.writeFileSync(tmpPath, data, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Clean up temp file on failure, fall back to direct write
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    fs.writeFileSync(filePath, data, 'utf8');
  }
}
