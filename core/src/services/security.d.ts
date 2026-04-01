export function hashPassword(pwd: string): Promise<string>;
export function verifyPassword(pwd: string, hash: string): Promise<boolean>;
export function rateLimitMiddleware(options?: any): any;
export function recordLoginAttempts(ip: string): void;
export function clearLoginAttempts(ip: string): void;
