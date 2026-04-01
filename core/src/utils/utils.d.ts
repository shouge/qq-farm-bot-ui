export function toNum(value: unknown): number;
export function toTimeSec(value: unknown): number;
export function getServerTimeSec(): number;
export function sleep(ms: number): Promise<void>;
export function toLong(value: unknown): any;
export function setLogHook(fn: (tag: string, msg: string, isWarn: boolean, meta?: any) => void): void;
export function log(tag: string, msg: string, meta?: any): void;
