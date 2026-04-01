import { EventEmitter } from 'node:events';
export function connect(code: string, onLoginSuccess?: () => void): void;
export function reconnect(newCode?: string): void;
export function cleanup(reason?: string): void;
export function getWs(): any;
export function sendMsgAsync(serviceName: string, methodName: string, bodyBytes: Buffer | Uint8Array, timeout?: number): Promise<{ body: Buffer; meta: any }>;
export function getUserState(): Record<string, any>;
export function getWsErrorState(): any;
export const networkEvents: EventEmitter;
