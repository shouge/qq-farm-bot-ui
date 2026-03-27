const process = require('node:process');
const { parentPort } = require('node:worker_threads');

/**
 * IPC 工具模块 - 统一 Worker 进程与主进程的通信
 * 支持 cluster 模式和 worker_threads 模式
 */

/**
 * 检测当前运行的 IPC 模式
 * @returns {'cluster' | 'worker_threads' | 'none'}
 */
function detectMode() {
    if (process.send) return 'cluster';
    if (parentPort) return 'worker_threads';
    return 'none';
}

/**
 * 向主进程发送消息
 * @param {any} payload 消息内容
 * @returns {boolean} 是否发送成功
 */
function sendToMaster(payload) {
    try {
        if (process.send) {
            process.send(payload);
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
 * @param {function} handler 消息处理器
 */
function onMasterMessage(handler) {
    if (process.send) {
        process.on('message', handler);
    }
    if (parentPort) {
        parentPort.on('message', handler);
    }
}

/**
 * 退出 Worker 进程
 * @param {number} code 退出码
 */
function exitWorker(code = 0) {
    if (parentPort) {
        try {
            parentPort.close();
        } catch {}
        return;
    }
    process.exit(code);
}

module.exports = {
    detectMode,
    sendToMaster,
    onMasterMessage,
    exitWorker,
};
