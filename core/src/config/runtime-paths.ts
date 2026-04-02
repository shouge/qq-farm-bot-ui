import fs from 'node:fs';
import path from 'node:path';
import nodeProcess from 'node:process';

export const isPackaged = !!(nodeProcess as typeof nodeProcess & { pkg?: unknown }).pkg;

export function getResourceRoot(): string {
  return path.join(__dirname, '..');
}

export function getResourcePath(...segments: string[]): string {
  return path.join(getResourceRoot(), ...segments);
}

export function getAppRootForWritable(): string {
  return isPackaged ? path.dirname(nodeProcess.execPath) : path.join(__dirname, '../..');
}

export function getDataDir(): string {
  return path.join(getAppRootForWritable(), 'data');
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDataFile(filename: string): string {
  return path.join(getDataDir(), filename);
}

export function getShareFilePath(): string {
  return path.join(getAppRootForWritable(), 'share.txt');
}
