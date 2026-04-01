import type { Request, Response } from 'express';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';

export class FarmController {
  constructor(private readonly provider: IPanelDataProvider) {}

  operate = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const result = await this.provider.doFarmOp(id, req.body?.opType || 'all');
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  singleLandOperate = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const data = await this.provider.doSingleLandOp(id, req.body || {});
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getLands = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false });
        return;
      }
      const data = await this.provider.getLands(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getSeeds = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false });
        return;
      }
      const data = await this.provider.getSeeds(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  private resolveAccId(req: Request): string {
    return String(req.headers['x-account-id'] || '').trim();
  }
}
