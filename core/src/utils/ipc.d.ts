export function sendToMaster(msg: Record<string, unknown>): void;
export function onMasterMessage(handler: (msg: Record<string, unknown>) => void): void;
export function exitWorker(code: number): void;
