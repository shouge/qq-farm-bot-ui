import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';

export function createAuthRouter(
  getAdminPasswordHash: () => string,
  getDisablePasswordAuth: () => boolean,
  setAdminPasswordHash: (hash: string) => void,
  setDisablePasswordAuth: (disabled: boolean) => void,
  onLogout?: (token: string) => void
): { router: Router; controller: AuthController } {
  const router = Router();
  const ctrl = new AuthController(
    getAdminPasswordHash,
    getDisablePasswordAuth,
    setAdminPasswordHash,
    setDisablePasswordAuth,
    onLogout
  );

  router.post('/login', ctrl.login);
  router.post('/logout', ctrl.logout);
  router.get('/auth/validate', ctrl.validate);
  router.post('/admin/change-password', ctrl.changePassword);
  router.get('/admin/password-auth-status', ctrl.getPasswordAuthStatus);
  router.post('/admin/toggle-password-auth', ctrl.togglePasswordAuth);

  return { router, controller: ctrl };
}
