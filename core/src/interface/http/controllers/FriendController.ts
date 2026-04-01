import type { Request, Response } from 'express';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';

export class FriendController {
  constructor(private readonly provider: IPanelDataProvider) {}

  getFriends = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false });
        return;
      }
      const data = await this.provider.getFriends(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getFriendLands = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false });
        return;
      }
      const gid = Number(req.params.gid);
      const data = await this.provider.getFriendLands(id, gid);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  doFriendOp = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const gid = Number(req.params.gid);
      const opType = String((req.body || {}).opType || '');
      const data = await this.provider.doFriendOp(id, gid, opType);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getFriendBlacklist = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const data = await this.provider.getFriendBlacklist(id);
      res.json({ ok: true, data: Array.isArray(data) ? data : [] });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  toggleFriendBlacklist = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const gid = Number((req.body || {}).gid);
      if (!gid) {
        res.status(400).json({ ok: false, error: 'Missing gid' });
        return;
      }
      const current = await this.provider.getFriendBlacklist(id);
      const list = Array.isArray(current) ? current : [];
      const next = list.includes(gid) ? list.filter((g) => g !== gid) : [...list, gid];
      this.provider.setFriendBlacklist(id, next);
      this.provider.broadcastConfig(id);
      res.json({ ok: true, data: next });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getInteractRecords = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const data = await this.provider.getInteractRecords(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getFriendCache = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const data = await this.provider.getFriendCache(id);
      res.json({ ok: true, data: Array.isArray(data) ? data : [] });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  updateFriendCacheFromVisitors = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const friends = await this.provider.extractFriendsFromInteractRecords(id);
      if (!Array.isArray(friends) || friends.length === 0) {
        const current = await this.provider.getFriendCache(id);
        res.json({ ok: true, data: Array.isArray(current) ? current : [], message: '没有找到新的访客记录' });
        return;
      }
      const saved = await this.provider.updateFriendCache(id, friends);
      this.provider.broadcastConfig(id);
      res.json({ ok: true, data: saved, message: '更新成功' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  importFriendCacheGids = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const input = req.body.gids;
      let gids: any[] = [];
      if (typeof input === 'string') {
        gids = input.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      } else if (Array.isArray(input)) {
        gids = input;
      }
      const validGids = gids
        .map((g) => Number(g))
        .filter((g) => Number.isFinite(g) && g > 0);
      if (validGids.length === 0) {
        res.json({ ok: false, error: '没有有效的 GID' });
        return;
      }
      const friends = validGids.map((gid) => ({
        gid,
        nick: `GID:${gid}`,
        avatarUrl: '',
      }));
      const saved = await this.provider.updateFriendCache(id, friends);
      this.provider.broadcastConfig(id);
      res.json({ ok: true, data: saved, message: `已导入 ${validGids.length} 个 GID` });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  deleteFriendCacheGid = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const gid = Number(req.params.gid);
      if (!gid || !Number.isFinite(gid)) {
        res.status(400).json({ ok: false, error: '无效的 GID' });
        return;
      }
      const current = await this.provider.getFriendCache(id);
      const next = (Array.isArray(current) ? current : []).filter((f: any) => f.gid !== gid);
      const saved = await this.provider.setFriendCache(id, next);
      this.provider.broadcastConfig(id);
      res.json({ ok: true, data: saved, message: `已删除 GID:${gid}` });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  private resolveAccId(req: Request): string {
    return String(req.headers['x-account-id'] || '').trim();
  }
}
