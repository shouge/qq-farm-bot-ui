import type { Request, Response } from 'express';
import type { IConfigRepository } from '../../../domain/ports/IConfigRepository';
import { sendPushooMessage } from '../../../services/push';

export class SettingsController {
  constructor(private readonly configRepo: IConfigRepository) {}

  getSettings = (req: Request, res: Response): void => {
    try {
      const id = String(req.headers['x-account-id'] || '');
      const data = {
        intervals: this.configRepo.getIntervals(id),
        strategy: this.configRepo.getPlantingStrategy(id),
        preferredSeed: this.configRepo.getPreferredSeedId(id),
        bagSeedPriority: (this.configRepo as any).getBagSeedPriority?.(id),
        friendBlockLevel: this.configRepo.getFriendBlockLevel(id),
        friendQuietHours: this.configRepo.getFriendQuietHours(id),
        automation: this.configRepo.getAutomation(id),
        ui: this.configRepo.getUI(),
        offlineReminder: this.configRepo.getOfflineReminder(),
        qrLogin: this.configRepo.getQrLoginConfig(),
        runtimeClient: this.configRepo.getRuntimeClientConfig(),
      };
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  saveSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = String(req.headers['x-account-id'] || '');
      this.configRepo.applyConfigSnapshot(req.body || {}, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  setTheme = async (req: Request, res: Response): Promise<void> => {
    try {
      const theme = String((req.body || {}).theme || '');
      const data = this.configRepo.setUITheme(theme);
      res.json({ ok: true, data: data || {} });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  setOfflineReminder = (req: Request, res: Response): void => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const data = this.configRepo.setOfflineReminder(body);
      res.json({ ok: true, data: data || {} });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  setQrLogin = (req: Request, res: Response): void => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const data = this.configRepo.setQrLoginConfig(body);
      res.json({ ok: true, data: data || {} });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  setRuntimeClient = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const data = this.configRepo.setRuntimeClientConfig(body);
      res.json({ ok: true, data: data || {} });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  testOfflineReminder = async (req: Request, res: Response): Promise<void> => {
    try {
      const saved = this.configRepo.getOfflineReminder();
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const cfg = { ...(saved || {}), ...body };

      const channel = String(cfg.channel || '').trim().toLowerCase();
      const endpoint = String(cfg.endpoint || '').trim();
      const token = String(cfg.token || '').trim();
      const titleBase = String(cfg.title || '账号下线提醒').trim();
      const msgBase = String(cfg.msg || '账号下线').trim();
      const custom_headers = String(cfg.custom_headers || '').trim();
      const custom_body = String(cfg.custom_body || '').trim();

      if (!channel) {
        res.status(400).json({ ok: false, error: '推送渠道不能为空' });
        return;
      }
      if ((channel === 'webhook' || channel === 'custom_request') && !endpoint) {
        res.status(400).json({ ok: false, error: '接口地址不能为空' });
        return;
      }

      const now = new Date();
      const ts = now.toISOString().replace('T', ' ').slice(0, 19);
      const ret = await sendPushooMessage({
        channel,
        endpoint,
        token,
        title: `${titleBase}（测试）`,
        content: `${msgBase}\n\n这是一条下线提醒测试消息。\n时间: ${ts}`,
        custom_headers,
        custom_body,
      });

      if (!ret || !ret.ok) {
        res.status(400).json({ ok: false, error: (ret && ret.msg) || '推送失败', data: ret || {} });
        return;
      }
      res.json({ ok: true, data: ret });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };
}
