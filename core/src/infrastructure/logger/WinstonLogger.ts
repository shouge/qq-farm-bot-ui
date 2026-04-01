import type { ILogger, ILoggerFactory } from '../../domain/ports/ILogger';
import { createModuleLogger, sanitizeMeta } from '../../services/logger';

export class WinstonLogger implements ILogger {
  constructor(private readonly delegate: ReturnType<typeof createModuleLogger>) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.delegate.info(message, sanitizeMeta(meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.delegate.warn(message, sanitizeMeta(meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.delegate.error(message, sanitizeMeta(meta));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.delegate.debug(message, sanitizeMeta(meta));
  }
}

export class WinstonLoggerFactory implements ILoggerFactory {
  create(module: string): ILogger {
    return new WinstonLogger(createModuleLogger(module));
  }
}
