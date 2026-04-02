export interface UserStateSnapshot {
  gid: number;
  name: string;
  level: number;
  gold: number;
  exp: number;
  coupon: number;
}

export interface MessageMeta {
  service_name: string;
  method_name: string;
  client_seq: bigint;
  server_seq: bigint;
  error_code?: number;
  error_message?: string;
}

export interface SendResult {
  body: Buffer;
  meta: MessageMeta;
}

export type NetworkEvent =
  | 'open'
  | 'close'
  | 'error'
  | 'kickout'
  | 'landsChanged'
  | 'sell'
  | 'farmHarvested'
  | 'friendApplicationReceived'
  | 'goodsUnlockNotify'
  | 'taskInfoNotify'
  | 'ws_error';

export type NetworkEventHandler = (payload: unknown) => void;

export interface INetworkClient {
  connect: (code: string, onLoginSuccess?: () => void) => void;
  reconnect: (newCode?: string) => void;
  disconnect: () => void;
  sendAsync: (
    serviceName: string,
    methodName: string,
    bodyBytes: Buffer,
    timeout?: number
  ) => Promise<SendResult>;
  getUserState: () => Readonly<UserStateSnapshot>;
  isConnected: () => boolean;
  onEvent: (event: NetworkEvent, handler: NetworkEventHandler) => void;
  offEvent: (event: NetworkEvent, handler: NetworkEventHandler) => void;
}
