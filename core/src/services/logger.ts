import fs from 'node:fs';
import path from 'node:path';
import nodeProcess from 'node:process';
import { ensureDataDir } from '../config/runtime-paths';
import type winston from 'winston';

let winstonInstance: typeof winston | null = null;
try {
  // eslint-disable-next-line ts/no-require-imports
  winstonInstance = require('winston');
} catch {
  winstonInstance = null;
}

// Module-level regex constants
const SENSITIVE_KEY_RE = /code|token|password|passwd|auth|ticket|cookie|session/i;
const REDACT_URL_PARAM_RE = /([?&](?:code|token|ticket|password)=)[^&\s]+/gi;
const REDACT_BEARER_RE = /(Bearer\s+)[\w.-]+/gi;

export function redactString(input: string): string {
  let text = String(input || '');
  text = text.replace(REDACT_URL_PARAM_RE, '$1[REDACTED]');
  text = text.replace(REDACT_BEARER_RE, '$1[REDACTED]');
  return text;
}

// eslint-disable-next-line ts/no-explicit-any
export function sanitizeMeta(value: any, depth = 0): any {
  if (depth > 4) return '[Truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => sanitizeMeta(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(String(k))) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitizeMeta(v, depth + 1);
    }
  }
  return out;
}

let fallbackLogDir: string | null = null;

function ensureFallbackLogDir(): string {
  if (fallbackLogDir) return fallbackLogDir;
  const dataDir = ensureDataDir();
  const dir = path.join(dataDir, 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fallbackLogDir = dir;
  return fallbackLogDir;
}

const LOG_FLUSH_INTERVAL_MS = 100;
const LOG_MAX_BUFFER_SIZE = 100;

interface LogEntry {
  level: string;
  line: string;
}

const logBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;

async function flushLogBuffer(): Promise<void> {
  if (isFlushing || logBuffer.length === 0) return;
  isFlushing = true;

  const logsToWrite = logBuffer.splice(0, logBuffer.length);

  try {
    const dir = ensureFallbackLogDir();
    const combinedLines: string[] = [];
    const errorLines: string[] = [];

    for (const { level, line } of logsToWrite) {
      combinedLines.push(line);
      if (level === 'error') {
        errorLines.push(line);
      }
    }

    const writePromises: Promise<void>[] = [
      fs.promises.appendFile(path.join(dir, 'combined.log'), combinedLines.join(''), 'utf8'),
    ];
    if (errorLines.length > 0) {
      writePromises.push(fs.promises.appendFile(path.join(dir, 'error.log'), errorLines.join(''), 'utf8'));
    }

    await Promise.all(writePromises);
  } catch {
    // ignore file write errors in fallback mode
  } finally {
    isFlushing = false;
    if (logBuffer.length > 0) {
      scheduleFlush();
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLogBuffer();
  }, LOG_FLUSH_INTERVAL_MS);
}

async function flushImmediate(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushLogBuffer();
}

function enqueueLog(level: string, line: string): void {
  logBuffer.push({ level, line });
  if (logBuffer.length >= LOG_MAX_BUFFER_SIZE) {
    flushLogBuffer();
  } else {
    scheduleFlush();
  }
}

function appendFallbackLog(level: string, moduleName: string, message: string, meta: Record<string, unknown>): void {
  try {
    const payload = {
      ts: new Date().toISOString(),
      level,
      module: moduleName,
      message: redactString(message),
      meta: sanitizeMeta(meta || {}),
    };
    const line = `${JSON.stringify(payload)}\n`;
    enqueueLog(level, line);
  } catch {
    // ignore file write errors in fallback mode
  }
}

nodeProcess.on('exit', () => {
  if (logBuffer.length > 0) {
    try {
      const dir = ensureFallbackLogDir();
      for (const { level, line } of logBuffer) {
        fs.appendFileSync(path.join(dir, 'combined.log'), line, 'utf8');
        if (level === 'error') {
          fs.appendFileSync(path.join(dir, 'error.log'), line, 'utf8');
        }
      }
    } catch {
      // ignore
    }
  }
});

nodeProcess.on('SIGINT', async () => {
  await flushImmediate();
  nodeProcess.exit(0);
});

nodeProcess.on('SIGTERM', async () => {
  await flushImmediate();
  nodeProcess.exit(0);
});

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

function createConsoleFallback(moduleName: string): Logger {
  const write = (level: string, message: string, meta?: Record<string, unknown>) => {
    const ts = new Date().toISOString();
    const safeMsg = redactString(message);
    const safeMeta = sanitizeMeta(meta);
    appendFallbackLog(level, moduleName, safeMsg, safeMeta);
    if (safeMeta && Object.keys(safeMeta).length > 0) {
      console.warn(`[${ts}] [${level}] [${moduleName}] ${safeMsg} ${JSON.stringify(safeMeta)}`);
    } else {
      console.warn(`[${ts}] [${level}] [${moduleName}] ${safeMsg}`);
    }
  };
  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    debug: (message, meta) => write('debug', message, meta),
  };
}

let rootLogger: winston.Logger | null = null;

function getRootLogger(): winston.Logger | null {
  if (rootLogger) return rootLogger;

  if (!winstonInstance) {
    rootLogger = null;
    return rootLogger;
  }

  const dataDir = ensureDataDir();
  const logDir = path.join(dataDir, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const level = String(nodeProcess.env.LOG_LEVEL || 'info').toLowerCase();
  const { combine, timestamp, errors, json, colorize, printf } = winstonInstance.format;

  rootLogger = winstonInstance.createLogger({
    level,
    defaultMeta: { app: 'qq-farm-bot' },
    transports: [
      new winstonInstance.transports.Console({
        format: combine(
          colorize(),
          timestamp(),
          errors({ stack: true }),
          printf((info: winston.Logform.TransformableInfo) => {
            const moduleName = info.module ? `[${info.module}] ` : '';
            const msg = redactString(info.message as string || '');
            const meta = { ...info } as Partial<winston.Logform.TransformableInfo>;
            delete meta.level;
            delete meta.message;
            delete meta.timestamp;
            delete meta.app;
            delete meta.module;
            const safeMeta = sanitizeMeta(meta);
            const hasMeta = safeMeta && Object.keys(safeMeta).length > 0;
            return `${info.timestamp} [${info.level}] ${moduleName}${msg}${hasMeta ? ` ${JSON.stringify(safeMeta)}` : ''}`;
          }),
        ),
      }),
      new winstonInstance.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: combine(timestamp(), errors({ stack: true }), json()),
      }),
      new winstonInstance.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: combine(timestamp(), errors({ stack: true }), json()),
      }),
    ],
  });

  return rootLogger;
}

export function createModuleLogger(moduleName = 'app'): Logger {
  const moduleTag = String(moduleName || 'app');
  const root = getRootLogger();
  if (!root) return createConsoleFallback(moduleTag);

  const child = root.child({ module: moduleTag });
  return {
    info(message, meta = {}) {
      child.info(redactString(message), sanitizeMeta(meta));
    },
    warn(message, meta = {}) {
      child.warn(redactString(message), sanitizeMeta(meta));
    },
    error(message, meta = {}) {
      child.error(redactString(message), sanitizeMeta(meta));
    },
    debug(message, meta = {}) {
      child.debug(redactString(message), sanitizeMeta(meta));
    },
  };
}
