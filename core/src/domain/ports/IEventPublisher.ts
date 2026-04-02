/**
 * IEventPublisher defines the interface for publishing events to external consumers.
 * This abstraction allows the runtime layer to emit events without depending on
 * specific transport implementations (Socket.IO, WebSocket, etc).
 */
export interface IEventPublisher {
  /**
   * Publish an event to all connected clients
   */
  publish(event: string, data: unknown): void;

  /**
   * Publish an event to a specific room/namespace
   */
  publishTo(room: string, event: string, data: unknown): void;

  /**
   * Check if the publisher is ready to accept events
   */
  isReady(): boolean;
}

/**
 * No-op implementation for testing or when event publishing is disabled
 */
export class NoOpEventPublisher implements IEventPublisher {
  publish(): void {
    // no-op
  }

  publishTo(): void {
    // no-op
  }

  isReady(): boolean {
    return false;
  }
}
