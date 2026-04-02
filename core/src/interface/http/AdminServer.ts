import express from 'express';
import type {Express, Request, Response, Router } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {  Server as SocketIOServer } from 'socket.io';
import type {Socket} from 'socket.io';
import { rateLimitMiddleware } from '../../services/security';
import { getResourcePath } from '../../config/runtime-paths';
import type { IPanelDataProvider } from '../../domain/ports/IPanelDataProvider';
import type { AuthController } from './controllers/AuthController';
import { version } from '../../../package.json';

export interface AdminServerDependencies {
  authRouter: Router;
  adminRouter: Router;
  accountRouter: Router;
  farmRouter: Router;
  settingsRouter: Router;
  friendRouter: Router;
  inventoryRouter: Router;
  logRouter: Router;
  qrRouter: Router;
  authController: AuthController;
  panelDataProvider: IPanelDataProvider;
}

export class AdminServer {
  private app: Express | null = null;
  private server: http.Server | null = null;
  private io: SocketIOServer | null = null;

  constructor(private readonly deps: AdminServerDependencies) {}

  start(port: number): http.Server {
    if (this.app) return this.server!;

    this.app = express();
    this.app.use(express.json());

    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Rate limiting
    this.app.use('/api', rateLimitMiddleware({
      windowMs: 60000,
      maxRequests: 100,
      keyGenerator: (req: any) => req.ip,
    }));

    // Static files
    const webDist = path.join(__dirname, '../../../../web/dist');
    if (fs.existsSync(webDist)) {
      this.app.use(express.static(webDist));
    } else {
      this.app.get('/', (req: Request, res: Response) => {
        res.send('web build not found. Please build the web project.');
      });
    }
    this.app.use('/game-config', express.static(getResourcePath('gameConfig')));

    // Public routes
    this.app.get('/api/ping', (req: Request, res: Response) => {
      res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    // Auth router first (login doesn't need auth)
    this.app.use('/api', this.deps.authRouter);

    // Auth required middleware for all remaining /api routes
    this.app.use('/api', (req, res, next) => {
      const publicPaths = ['/login', '/logout', '/qr/create', '/qr/check', '/auth/validate', '/admin/password-auth-status'];
      if (publicPaths.includes(req.path)) return next();
      const token = String(req.headers['x-admin-token'] || '');
      if (!token || !this.deps.authController.validateToken(token)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      (req as any).adminToken = token;
      next();
    });

    // Business routers
    this.app.use('/api', this.deps.adminRouter);
    this.app.use('/api', this.deps.accountRouter);
    this.app.use('/api', this.deps.farmRouter);
    this.app.use('/api', this.deps.settingsRouter);
    this.app.use('/api', this.deps.friendRouter);
    this.app.use('/api', this.deps.inventoryRouter);
    this.app.use('/api', this.deps.logRouter);
    this.app.use('/api', this.deps.qrRouter);

    // Fallback
    this.app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
        res.status(404).json({ ok: false, error: 'Not Found' });
        return;
      }
      if (fs.existsSync(webDist)) {
        res.sendFile(path.join(webDist, 'index.html'));
      } else {
        res.status(404).send('web build not found. Please build the web project.');
      }
    });

    this.server = this.app.listen(port, '0.0.0.0', () => {
      console.log(`Admin server started on port ${port}`);
    });

    this.io = new SocketIOServer(this.server, {
      path: '/socket.io',
      cors: { origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['x-admin-token', 'x-account-id'] },
    });

    this.io.use((socket, next) => {
      const authToken = String((socket.handshake.auth as any)?.token || socket.handshake.headers['x-admin-token'] || '');
      if (!authToken || !this.deps.authController.validateToken(authToken)) {
        return next(new Error('Unauthorized'));
      }
      (socket as any).data.adminToken = authToken;
      next();
    });

    this.io.on('connection', (socket: Socket) => {
      const initialAccountRef = String((socket.handshake.auth as any)?.accountId || socket.handshake.query?.accountId || '');
      this.applySocketSubscription(socket, initialAccountRef);
      socket.emit('ready', { ok: true, ts: Date.now() });

      socket.on('subscribe', (payload) => {
        const body = (payload && typeof payload === 'object') ? payload : {};
        this.applySocketSubscription(socket, (body as any).accountId || '');
      });
    });

    return this.server;
  }

  getIO(): SocketIOServer | null {
    return this.io;
  }

  private applySocketSubscription(socket: Socket, accountRef = '') {
    const incoming = String(accountRef || '').trim();
    const resolved = incoming && incoming !== 'all' ? this.deps.panelDataProvider.resolveAccountId(incoming) : '';
    for (const room of socket.rooms) {
      if (room.startsWith('account:')) socket.leave(room);
    }
    if (resolved) {
      socket.join(`account:${resolved}`);
      (socket as any).data.accountId = resolved;
    } else {
      socket.join('account:all');
      (socket as any).data.accountId = '';
    }
    socket.emit('subscribed', { accountId: (socket as any).data.accountId || 'all' });

    try {
      const targetId = (socket as any).data.accountId || '';
      if (targetId) {
        const currentStatus = this.deps.panelDataProvider.getStatus(targetId);
        socket.emit('status:update', { accountId: targetId, status: currentStatus });
      }
      const currentLogs = this.deps.panelDataProvider.getLogs(targetId, { limit: 100 });
      socket.emit('logs:snapshot', {
        accountId: targetId || 'all',
        logs: Array.isArray(currentLogs) ? currentLogs : (currentLogs as any)?.data || [],
      });
      const currentAccountLogs = this.deps.panelDataProvider.getAccountLogs(100);
      socket.emit('account-logs:snapshot', {
        logs: Array.isArray(currentAccountLogs) ? currentAccountLogs : [],
      });
    } catch {
      // ignore snapshot push errors
    }
  }
}
