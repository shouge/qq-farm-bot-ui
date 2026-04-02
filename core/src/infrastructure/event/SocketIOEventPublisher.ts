import type { Server as SocketIOServer } from 'socket.io';
import type { IEventPublisher } from '../../domain/ports/IEventPublisher';

/**
 * SocketIOEventPublisher adapts Socket.IO to the IEventPublisher interface.
 * This allows the runtime layer to publish events without directly depending on Socket.IO.
 */
export class SocketIOEventPublisher implements IEventPublisher {
  constructor(private io: SocketIOServer | null) {}

  publish(event: string, data: unknown): void {
    if (!this.io) return;
    this.io.emit(event, data);
  }

  publishTo(room: string, event: string, data: unknown): void {
    if (!this.io) return;
    this.io.to(room).emit(event, data);
  }

  isReady(): boolean {
    return this.io !== null;
  }
}

/**
 * LazyEventPublisher defers the Socket.IO resolution until first use.
 * Useful when Socket.IO is not immediately available at construction time.
 */
export class LazyEventPublisher implements IEventPublisher {
  private resolver: (() => SocketIOServer | null) | null = null;

  setResolver(resolver: () => SocketIOServer | null): void {
    this.resolver = resolver;
  }

  publish(event: string, data: unknown): void {
    const io = this.resolver?.();
    if (!io) return;
    io.emit(event, data);
  }

  publishTo(room: string, event: string, data: unknown): void {
    const io = this.resolver?.();
    if (!io) return;
    io.to(room).emit(event, data);
  }

  isReady(): boolean {
    return this.resolver?.() !== null;
  }
}
