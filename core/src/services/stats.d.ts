export function recordOperation(type: string, count?: number): void;
export function initStats(gold: number, exp: number, coupon?: number): void;
export function updateStats(currentGold: number, currentExp: number): void;
export function setInitialValues(gold: number, exp: number, coupon?: number): void;
export function recordGoldExp(gold: number, exp: number): void;
export function resetSessionGains(): void;
export function getStats(statusData: any, userState: any, connected: boolean, limits: any): any;
