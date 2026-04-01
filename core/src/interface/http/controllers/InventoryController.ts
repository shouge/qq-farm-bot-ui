import type { Request, Response } from 'express';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';

export class InventoryController {
  constructor(private readonly provider: IPanelDataProvider) {}

  getBag = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false });
        return;
      }
      const data = await this.provider.getBag(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getBagSeeds = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false });
        return;
      }
      const data = await this.provider.getBagSeeds(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getDailyGifts = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false });
        return;
      }
      const data = await this.provider.getDailyGifts(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  private resolveAccId(req: Request): string {
    return String(req.headers['x-account-id'] || '').trim();
  }
}
