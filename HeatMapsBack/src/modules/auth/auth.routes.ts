import { Router } from 'express';
import authController from './auth.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();

router.post('/login', (req, res) => authController.login(req, res));
router.post('/register', (req, res) => authController.register(req, res));
router.post('/verify-code', (req, res) => authController.verifyCode(req, res));
router.post('/logout', authMiddleware, (req, res) => authController.logout(req, res));
router.get('/session', authMiddleware, (req, res) => authController.session(req, res));
router.post('/cancel-verification', (req, res) => authController.cancelVerification(req, res));

export default router;