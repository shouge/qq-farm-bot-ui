export type EventHandler<T = unknown> = (payload: T) => void;

export interface IEventBus {
  on<T = unknown>(event: string, handler: EventHandler<T>): void;
  off<T = unknown>(event: string, handler: EventHandler<T>): void;
  emit<T = unknown>(event: string, payload: T): void;
  once<T = unknown>(event: string, handler: EventHandler<T>): void;
}
