import QRCode from 'qrcode';
import { sleep } from '../../utils/utils';
import type { IWorkerProcessManager } from '../../domain/ports/IWorkerProcessManager';

export interface ReloginReminderOptions {
  store: any;
  miniProgramLoginSession: typeof import('../../services/qrlogin').MiniProgramLoginSession;
  sendPushooMessage: (options: any) => Promise<{ ok?: boolean; msg?: string } | null>;
  log: (tag: string, msg: string, extra?: any) => void;
  addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
  getAccounts: () => { accounts: any[] };
  addOrUpdateAccount: (account: any) => any;
  workerManager: IWorkerProcessManager;
}

export class ReloginReminderService {
  private reloginWatchers = new Map<string, { startedAt: number }>();

  constructor(private readonly opts: ReloginReminderOptions) {}

  getOfflineAutoDeleteMs(): number {
    const cfg = this.opts.store.getOfflineReminder ? this.opts.store.getOfflineReminder() : null;
    if (!cfg || !cfg.offlineDeleteEnabled) return Number.POSITIVE_INFINITY;
    const sec = Math.max(1, Number.parseInt(cfg.offlineDeleteSec, 10) || 1);
    return sec * 1000;
  }

  private getQrLoginOptions(): { apiDomain: string } {
    const cfg = this.opts.store.getQrLoginConfig ? this.opts.store.getQrLoginConfig() : null;
    return { apiDomain: String((cfg && cfg.apiDomain) || 'q.qq.com').trim() || 'q.qq.com' };
  }

  applyReloginCode({ accountId = '', accountName = '', authCode = '', uin = '' }: {
    accountId?: string;
    accountName?: string;
    authCode?: string;
    uin?: string;
  }): void {
    const code = String(authCode || '').trim();
    if (!code) return;

    const data = this.opts.getAccounts();
    const list = Array.isArray(data.accounts) ? data.accounts : [];
    const found = list.find((a) => String(a.id) === String(accountId));
    const avatar = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : '';

    if (found) {
      this.opts.addOrUpdateAccount({
        id: found.id,
        name: found.name,
        code,
        platform: found.platform || 'qq',
        qq: uin || found.qq || found.uin || '',
        uin: uin || found.uin || found.qq || '',
        avatar: avatar || found.avatar || '',
      });
      this.opts.workerManager.restartWorker({
        ...found,
        code,
        qq: uin || found.qq || found.uin || '',
        uin: uin || found.uin || found.qq || '',
        avatar: avatar || found.avatar || '',
      });
      this.opts.addAccountLog('update', `重登录成功，已更新账号: ${found.name}`, found.id, found.name, { reason: 'relogin' });
      this.opts.log('系统', `重登录成功，账号已更新并重启: ${found.name}`);
      return;
    }

    const created = this.opts.addOrUpdateAccount({
      name: accountName || (uin ? String(uin) : '重登录账号'),
      code,
      platform: 'qq',
      qq: uin || '',
      uin: uin || '',
      avatar,
    });
    const newAcc = (created.accounts || [])[created.accounts.length - 1];
    if (newAcc) {
      this.opts.workerManager.startWorker(newAcc);
      this.opts.addAccountLog('add', `重登录成功，已新增账号: ${newAcc.name}`, newAcc.id, newAcc.name, { reason: 'relogin' });
      this.opts.log('系统', `重登录成功，已新增账号并启动: ${newAcc.name}`, { accountId: String(newAcc.id), accountName: newAcc.name });
    }
  }

  startReloginWatcher({ loginCode, accountId = '', accountName = '' }: { loginCode: string; accountId?: string; accountName?: string }): void {
    const code = String(loginCode || '').trim();
    if (!code) return;

    const key = `${accountId || 'unknown'}:${code}`;
    if (this.reloginWatchers.has(key)) return;
    this.reloginWatchers.set(key, { startedAt: Date.now() });
    this.opts.log('系统', `已启动重登录监听: ${accountName || accountId || '未知账号'}`, { accountId: String(accountId || ''), accountName: accountName || '' });

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      this.reloginWatchers.delete(key);
    };

    (async () => {
      const maxRounds = 120;
      for (let i = 0; i < maxRounds; i += 1) {
        try {
          const status = await this.opts.miniProgramLoginSession.queryStatus(code, this.getQrLoginOptions());
          if (!status || status.status === 'Wait') {
            await sleep(1000);
            continue;
          }
          if (status.status === 'Used') {
            this.opts.log('系统', `重登录二维码已失效: ${accountName || accountId || '未知账号'}`, { accountId: String(accountId || ''), accountName: accountName || '' });
            stop();
            return;
          }
          if (status.status === 'OK') {
            const ticket = String(status.ticket || '').trim();
            const uin = String(status.uin || '').trim();
            if (!ticket) {
              this.opts.log('错误', '重登录监听失败: ticket 为空');
              stop();
              return;
            }
            const authCode = await this.opts.miniProgramLoginSession.getAuthCode(ticket, '1112386029', this.getQrLoginOptions());
            if (!authCode) {
              this.opts.log('错误', '重登录监听失败: 未获取到新 code');
              stop();
              return;
            }
            this.applyReloginCode({ accountId, accountName, authCode, uin });
            stop();
            return;
          }
          await sleep(1000);
        } catch {
          await sleep(1000);
        }
      }
      this.opts.log('系统', `重登录监听超时: ${accountName || accountId || '未知账号'}`, { accountId: String(accountId || ''), accountName: accountName || '' });
      stop();
    })();
  }

  async triggerOfflineReminder(payload: any = {}): Promise<void> {
    try {
      const cfg = this.opts.store.getOfflineReminder ? this.opts.store.getOfflineReminder() : null;
      if (!cfg) return;

      const channel = String(cfg.channel || '').trim().toLowerCase();
      const reloginUrlMode = String(cfg.reloginUrlMode || 'none').trim().toLowerCase();
      const endpoint = String(cfg.endpoint || '').trim();
      const token = String(cfg.token || '').trim();
      const baseTitle = String(cfg.title || '').trim();
      const custom_headers = String(cfg.custom_headers || '').trim();
      const custom_body = String(cfg.custom_body || '').trim();

      const accountName = String(payload.accountName || payload.accountId || '').trim();
      const title = accountName ? `${baseTitle} ${accountName}` : baseTitle;
      let content = String(cfg.msg || '').trim();

      if (!channel || !title || !content) return;
      if ((channel === 'webhook' || channel === 'custom_request') && !endpoint) return;
      if (channel !== 'custom_request' && !token) return;

      if (reloginUrlMode === 'qq_link' || reloginUrlMode === 'qr_code' || reloginUrlMode === 'all') {
        try {
          const qr = await this.opts.miniProgramLoginSession.requestLoginCode(this.getQrLoginOptions());
          const loginCode = String((qr && qr.code) || '').trim();
          const qqUrl = String((qr && (qr.url || qr.loginUrl)) || '').trim();

          if (qqUrl) {
            if (reloginUrlMode === 'qq_link') {
              content = `${content}\n\n登录链接: ${qqUrl}`;
            } else if (reloginUrlMode === 'qr_code') {
              const image = await QRCode.toDataURL(qqUrl, { width: 300, margin: 1, errorCorrectionLevel: 'M' });
              content = `${content}\n\n登录二维码:\n\n<img src="${image}" alt="登录二维码" width="300" height="300" />`;
            } else if (reloginUrlMode === 'all') {
              const image = await QRCode.toDataURL(qqUrl, { width: 300, margin: 1, errorCorrectionLevel: 'M' });
              content = `${content}\n\n登录链接: ${qqUrl}\n登录二维码:\n<img src="${image}" alt="登录二维码" width="300" height="300" />`;
            }
          }

          if (loginCode) {
            this.startReloginWatcher({ loginCode, accountId: String(payload.accountId || '').trim(), accountName: String(payload.accountName || '').trim() });
          }
        } catch (e: any) {
          this.opts.log('错误', `获取重登录链接失败: ${e?.message || ''}`);
        }
      }

      const ret = await this.opts.sendPushooMessage({ channel, endpoint, token, title, content, custom_headers, custom_body });

      if (ret && ret.ok) {
        this.opts.log('系统', `下线提醒发送成功: ${accountName}`);
      } else {
        this.opts.log('错误', `下线提醒发送失败: ${(ret && ret.msg) || 'unknown'}`);
      }
    } catch (e: any) {
      this.opts.log('错误', `下线提醒发送异常: ${e?.message || ''}`);
    }
  }
}
