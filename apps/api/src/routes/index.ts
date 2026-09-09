import express from 'express';
import user from './user.routes';
import webhook from './webhook.route';
import admin from './admin.routes';
import bank from './bank.routes';

const router = express.Router();
router.use('/users', user);
router.use('/webhooks', webhook);
router.use('/admin', admin);
router.use('/banks', bank);

export default router;
