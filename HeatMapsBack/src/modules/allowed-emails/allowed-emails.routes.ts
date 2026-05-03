import { Router } from 'express';
import allowedEmailsController from './allowed-emails.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

const router = Router();

router.get('/', authMiddleware, (req, res) => allowedEmailsController.getAll(req, res));
router.post('/', authMiddleware, (req, res) => allowedEmailsController.add(req, res));
router.delete('/:id', authMiddleware, (req, res) => allowedEmailsController.remove(req, res));

export default router;