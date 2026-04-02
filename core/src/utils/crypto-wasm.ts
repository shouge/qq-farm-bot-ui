import fs from 'node:fs';
import path from 'node:path';

// WebAssembly exports interface
interface WasmExports {
  v: WebAssembly.Memory;
  E: () => void;
  _: (ptr: number, len: number) => number;
  J: (ptr: number, len: number) => void;
  K: (ptr: number, len: number) => void;
  z: (size: number) => number;
  A: (ptr: number) => void;
}

let memory: WebAssembly.Memory | null = null;
let encryptRaw: ((ptr: number, len: number) => void) | null = null;
let decryptRaw: ((ptr: number, len: number) => void) | null = null;
let generateTokenRaw: ((ptr: number, len: number) => number) | null = null;
let createBufRaw: ((size: number) => number) | null = null;
let destroyBufRaw: ((ptr: number) => void) | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let initPromise: Promise<void> | null = null;

export function initWasm(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    try {
      const wasmPath = path.join(__dirname, 'tsdk.wasm');
      const wasmBuffer = fs.readFileSync(wasmPath);
      const importObject: WebAssembly.Imports = {
        a: {
          a: () => { }, b: () => { }, c: () => { }, d: () => { }, e: () => { },
          f: () => { }, g: () => { }, h: () => { }, i: () => { }, j: () => { },
          k: () => { }, l: () => { }, m: () => { }, n: () => { }, o: () => { },
          p: () => { }, q: () => { }, r: () => { }, s: () => { }, t: () => { },
          u: () => { },
        },
      };

      WebAssembly.instantiate(wasmBuffer, importObject).then(({ instance }) => {
        const exports = instance.exports as unknown as WasmExports;
        try { exports.E(); } catch { } // init_runtime
        memory = exports.v;
        generateTokenRaw = exports._;
        encryptRaw = exports.J;
        decryptRaw = exports.K;
        createBufRaw = exports.z;
        destroyBufRaw = exports.A;
        resolve();
      }).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
  return initPromise;
}

/**
 * 生成签名 token (由于抓包未见 URL 带有签名，此方法为防万一备用)
 */
export async function generateToken(str: string): Promise<string> {
  if (!memory) await initWasm();
  if (!memory || !createBufRaw || !generateTokenRaw || !destroyBufRaw) {
    throw new Error('WASM not initialized');
  }

  const data = encoder.encode(str);
  const ptr = createBufRaw(data.length + 1);
  const memView = new Uint8Array(memory.buffer);
  memView.set(data, ptr);
  memView[ptr + data.length] = 0;

  const resPtr = generateTokenRaw(ptr, data.length);
  let end = resPtr;
  while (memView[end] !== 0 && end - resPtr < 1000) end++;

  const outputBytes = memView.slice(resPtr, end);
  destroyBufRaw(ptr);
  return decoder.decode(outputBytes);
}

/**
 * 核心协议二进制负载加密
 */
export async function encryptBuffer(buffer: Buffer): Promise<Buffer> {
  if (!memory) await initWasm();
  if (!memory || !createBufRaw || !encryptRaw || !destroyBufRaw) {
    throw new Error('WASM not initialized');
  }

  const ptr = createBufRaw(buffer.length);
  const memView = new Uint8Array(memory.buffer);
  memView.set(buffer, ptr);

  encryptRaw(ptr, buffer.length); // in-place

  const output = Buffer.from(memory.buffer, ptr, buffer.length);
  const result = Buffer.from(output); // copy it out
  destroyBufRaw(ptr);
  return result;
}

/**
 * 核心协议二进制负载解密
 */
export async function decryptBuffer(buffer: Buffer): Promise<Buffer> {
  if (!memory) await initWasm();
  if (!memory || !createBufRaw || !decryptRaw || !destroyBufRaw) {
    throw new Error('WASM not initialized');
  }

  const ptr = createBufRaw(buffer.length);
  const memView = new Uint8Array(memory.buffer);
  memView.set(buffer, ptr);

  decryptRaw(ptr, buffer.length); // in-place

  const output = Buffer.from(memory.buffer, ptr, buffer.length);
  const result = Buffer.from(output); // copy it out
  destroyBufRaw(ptr);
  return result;
}

// Alias for backward compatibility
export { generateToken as encryptData };
