import type { Request, Response } from 'express';
import type { IConfigRepository } from '../../../domain/ports/IConfigRepository';
import { MiniProgramLoginSession } from '../../../services/qrlogin';

export class QrController {
  constructor(private readonly configRepo: IConfigRepository) {}

  createQr = async (req: Request, res: Response): Promise<void> => {
    try {
      const qrLogin = this.configRepo.getQrLoginConfig();
      const result = await MiniProgramLoginSession.requestLoginCode({ apiDomain: qrLogin.apiDomain });
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  checkQr = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.body || {};
      if (!code) {
        res.status(400).json({ ok: false, error: 'Missing code' });
        return;
      }
      const qrLogin = this.configRepo.getQrLoginConfig();
      const result = await MiniProgramLoginSession.queryStatus(String(code), { apiDomain: qrLogin.apiDomain });

      if (result.status === 'OK') {
        const ticket = result.ticket;
        const uin = result.uin || '';
        const nickname = result.nickname || '';
        const appid = '1112386029';
        const authCode = await MiniProgramLoginSession.getAuthCode(ticket, appid, { apiDomain: qrLogin.apiDomain });
        let avatar = '';
        if (uin) {
          avatar = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
        }
        res.json({ ok: true, data: { status: 'OK', code: authCode, uin, avatar, nickname } });
      } else if (result.status === 'Used') {
        res.json({ ok: true, data: { status: 'Used' } });
      } else if (result.status === 'Wait') {
        res.json({ ok: true, data: { status: 'Wait' } });
      } else {
        res.json({ ok: true, data: { status: 'Error', error: result.msg || '' } });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };
}
