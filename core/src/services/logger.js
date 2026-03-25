const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { ensureDataDir } = require('../config/runtime-paths');

let winston = null;
try {
    // 可选依赖：未安装时回退到 console，避免运行中断

    winston = require('winston');
} catch {
    winston = null;
}

const SENSITIVE_KEY_RE = /code|token|password|passwd|auth|ticket|cookie|session/i;

function redactString(input) {
    let text = String(input || '');
    text = text.replace(/([?&](?:code|token|ticket|password)=)[^&\s]+/gi, '$1[REDACTED]');
    text = text.replace(/(Bearer\s+)[\w.-]+/gi, '$1[REDACTED]');
    return text;
}

function sanitizeMeta(value, depth = 0) {
    if (depth > 4) return '[Truncated]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => sanitizeMeta(v, depth + 1));

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_KEY_RE.test(String(k))) {
            out[k] = '[REDACTED]';
        } else {
            out[k] = sanitizeMeta(v, depth + 1);
        }
    }
    return out;
}

let fallbackLogDir = null;

function ensureFallbackLogDir() {
    if (fallbackLogDir) return fallbackLogDir;
    const dataDir = ensureDataDir();
    const dir = path.join(dataDir, 'logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fallbackLogDir = dir;
    return fallbackLogDir;
}

// 异步日志写入队列配置
const LOG_FLUSH_INTERVAL_MS = 100; // 100ms 刷新一次
const LOG_MAX_BUFFER_SIZE = 100;   // 最多缓冲100条

let logBuffer = [];
let flushTimer = null;
let isFlushing = false;

/**
 * 刷新日志缓冲区到文件
 */
async function flushLogBuffer() {
    if (isFlushing || logBuffer.length === 0) return;
    isFlushing = true;

    const logsToWrite = logBuffer.splice(0, logBuffer.length);

    try {
        const dir = ensureFallbackLogDir();
        const combinedLines = [];
        const errorLines = [];

        for (const { level, line } of logsToWrite) {
            combinedLines.push(line);
            if (level === 'error') {
                errorLines.push(line);
            }
        }

        // 批量异步写入
        const writePromises = [
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
        // 如果缓冲区内还有数据，继续刷新
        if (logBuffer.length > 0) {
            scheduleFlush();
        }
    }
}

/**
 * 调度刷新
 */
function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushLogBuffer();
    }, LOG_FLUSH_INTERVAL_MS);
}

/**
 * 立即刷新（用于进程退出时）
 */
async function flushImmediate() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    await flushLogBuffer();
}

/**
 * 添加日志到缓冲区
 */
function enqueueLog(level, line) {
    logBuffer.push({ level, line });
    if (logBuffer.length >= LOG_MAX_BUFFER_SIZE) {
        flushLogBuffer();
    } else {
        scheduleFlush();
    }
}

/**
 * 异步写入回退日志
 */
function appendFallbackLog(level, moduleName, message, meta) {
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

// 进程退出时刷新日志
process.on('exit', () => {
    // 同步刷新剩余日志
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

process.on('SIGINT', async () => {
    await flushImmediate();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await flushImmediate();
    process.exit(0);
});

function createConsoleFallback(moduleName) {
    const write = (level, message, meta) => {
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

let rootLogger = null;

function getRootLogger() {
    if (rootLogger) return rootLogger;

    if (!winston) {
        rootLogger = null;
        return rootLogger;
    }

    const dataDir = ensureDataDir();
    const logDir = path.join(dataDir, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const level = String(process.env.LOG_LEVEL || 'info').toLowerCase();
    const { combine, timestamp, errors, json, colorize, printf } = winston.format;

    rootLogger = winston.createLogger({
        level,
        defaultMeta: { app: 'qq-farm-bot' },
        transports: [
            new winston.transports.Console({
                format: combine(
                    colorize(),
                    timestamp(),
                    errors({ stack: true }),
                    printf((info) => {
                        const moduleName = info.module ? `[${info.module}] ` : '';
                        const msg = redactString(info.message || '');
                        const meta = { ...info };
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
            new winston.transports.File({
                filename: path.join(logDir, 'combined.log'),
                format: combine(timestamp(), errors({ stack: true }), json()),
            }),
            new winston.transports.File({
                filename: path.join(logDir, 'error.log'),
                level: 'error',
                format: combine(timestamp(), errors({ stack: true }), json()),
            }),
        ],
    });

    return rootLogger;
}

function createModuleLogger(moduleName = 'app') {
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

module.exports = {
    createModuleLogger,
    sanitizeMeta,
    redactString,
};
