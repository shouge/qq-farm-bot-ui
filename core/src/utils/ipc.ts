import nodeProcess from 'node:process';
import { parentPort } from 'node:worker_threads';

/**
 * IPC 工具模块 - 统一 Worker 进程与主进程的通信
 * 支持 cluster 模式和 worker_threads 模式
 */

export type IpcMode = 'cluster' | 'worker_threads' | 'none';

/**
 * 检测当前运行的 IPC 模式
 */
export function detectMode(): IpcMode {
  if (nodeProcess.send) return 'cluster';
  if (parentPort) return 'worker_threads';
  return 'none';
}

/**
 * 向主进程发送消息
 * @param payload 消息内容
 * @returns 是否发送成功
 */
export function sendToMaster(payload: unknown): boolean {
  try {
    if (nodeProcess.send) {
      nodeProcess.send(payload);
      return true;
    }
    if (parentPort && typeof parentPort.postMessage === 'function') {
      parentPort.postMessage(payload);
      return true;
    }
  } catch {
    // 发送失败静默处理
  }
  return false;
}

/**
 * 监听来自主进程的消息
 * @param handler 消息处理器
 */
export function onMasterMessage(handler: (msg: unknown) => void): void {
  if (nodeProcess.send) {
    nodeProcess.on('message', handler);
  }
  if (parentPort) {
    parentPort.on('message', handler);
  }
}

/**
 * 退出 Worker 进程
 * @param code 退出码
 */
export function exitWorker(code = 0): void {
  if (parentPort) {
    try {
      parentPort.close();
    } catch {}
    return;
  }
  nodeProcess.exit(code);
}
