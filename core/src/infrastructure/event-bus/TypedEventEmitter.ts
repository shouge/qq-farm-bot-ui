import EventEmitter from 'node:events';
import type { EventHandler, IEventBus } from '../../domain/ports/IEventBus';

export class TypedEventEmitter implements IEventBus {
  private readonly emitter = new EventEmitter();

  on<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.emitter.on(event, handler as (payload: unknown) => void);
  }

  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.emitter.off(event, handler as (payload: unknown) => void);
  }

  emit<T = unknown>(event: string, payload: T): void {
    this.emitter.emit(event, payload);
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.emitter.once(event, handler as (payload: unknown) => void);
  }
}
