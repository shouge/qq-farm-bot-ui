import WebSocket from 'ws';
import type {
  INetworkClient,
  NetworkEvent,
  NetworkEventHandler,
  SendResult,
  UserStateSnapshot,
} from '../../domain/ports/INetworkClient';
import type { IEventBus } from '../../domain/ports/IEventBus';
import type { IScheduler } from '../../domain/ports/IScheduler';
import {
  connect as legacyConnect,
  reconnect as legacyReconnect,
  cleanup as legacyCleanup,
  getWs as legacyGetWs,
  sendMsgAsync as legacySendMsgAsync,
  getUserState as legacyGetUserState,
  getWsErrorState as legacyGetWsErrorState,
  networkEvents as legacyNetworkEvents,
} from '../../utils/network';

/**
 * Adapter that wraps the legacy network.js module.
 * NOTE: Because network.js uses module-level globals, this adapter
 * cannot run multiple independent connections in the same process.
 * It is suitable for the current worker-per-process architecture.
 */
export class WsNetworkClient implements INetworkClient {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly scheduler: IScheduler
  ) {
    this.relayLegacyEvents();
  }

  private relayLegacyEvents(): void {
    const relayed: Array<{ from: string; to: NetworkEvent }> = [
      { from: 'kickout', to: 'kickout' },
      { from: 'landsChanged', to: 'landsChanged' },
      { from: 'sell', to: 'sell' },
      { from: 'farmHarvested', to: 'farmHarvested' },
      { from: 'friendApplicationReceived', to: 'friendApplicationReceived' },
      { from: 'goodsUnlockNotify', to: 'goodsUnlockNotify' },
      { from: 'taskInfoNotify', to: 'taskInfoNotify' },
      { from: 'ws_error', to: 'ws_error' },
    ];

    for (const { from, to } of relayed) {
      legacyNetworkEvents.on(from, (payload: unknown) => {
        this.eventBus.emit(to, payload);
      });
    }
  }

  connect(code: string, onLoginSuccess?: () => void): void {
    legacyConnect(code, onLoginSuccess);
  }

  reconnect(newCode?: string): void {
    legacyReconnect(newCode);
  }

  disconnect(): void {
    legacyCleanup('主动断开');
    const ws = legacyGetWs();
    if (ws) {
      ws.close();
    }
  }

  async sendAsync(
    serviceName: string,
    methodName: string,
    bodyBytes: Buffer,
    timeout = 10000
  ): Promise<SendResult> {
    return legacySendMsgAsync(serviceName, methodName, bodyBytes, timeout);
  }

  getUserState(): Readonly<UserStateSnapshot> {
    return legacyGetUserState() as UserStateSnapshot;
  }

  isConnected(): boolean {
    const ws = legacyGetWs();
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  onEvent(event: NetworkEvent, handler: NetworkEventHandler): void {
    this.eventBus.on(event, handler);
  }

  offEvent(event: NetworkEvent, handler: NetworkEventHandler): void {
    this.eventBus.off(event, handler);
  }
}
