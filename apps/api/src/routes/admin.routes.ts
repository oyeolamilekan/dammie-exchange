import express from 'express';
import {
  getCurrentAdminController,
  loginAdminController,
  logoutAdminController,
} from '../controllers/admin-auth.controller';
import {
  authenticateAdmin,
  validateAdminMutationOrigin,
} from '../middlewares/admin-auth.middleware';
import {
  createAdminCurrencyController,
  createAdminCurrencyNetworkController,
  createAdminNetworkController,
  deleteAdminCurrencyController,
  deleteAdminCurrencyNetworkController,
  deleteAdminNetworkController,
  getAdminCatalogController,
  getAdminCurrencyNetworksController,
  getAdminCurrenciesController,
  getAdminOverviewController,
  getAdminNetworksController,
  getAdminUserAccountVersionsController,
  getAdminUserController,
  getAdminUserConversationsController,
  getAdminUserTransactionsController,
  getAdminUsersController,
  createAdminFeeController,
  getAdminFeeAuditController,
  getAdminFeesController,
  updateAdminCurrencyController,
  updateAdminFeeController,
  updateAdminNetworkController,
} from '../controllers/admin-data.controller';
import { sanitizeAdminResponses } from '../middlewares/admin-response.middleware';

const router = express.Router();

router.use(sanitizeAdminResponses);
router.use(validateAdminMutationOrigin);
router.post('/auth/login', loginAdminController);
router.post('/auth/logout', authenticateAdmin, logoutAdminController);
router.get('/auth/me', authenticateAdmin, getCurrentAdminController);
router.use(authenticateAdmin);
router.get('/overview', getAdminOverviewController);
router.get('/catalog', getAdminCatalogController);
router.get('/catalog/currencies', getAdminCurrenciesController);
router.get('/catalog/networks', getAdminNetworksController);
router.get('/catalog/currency-networks', getAdminCurrencyNetworksController);
router.get('/fees', getAdminFeesController);
router.post('/fees', createAdminFeeController);
router.patch('/fees/:id', updateAdminFeeController);
router.get('/fees/:id/audit', getAdminFeeAuditController);
router.post('/catalog/currencies', createAdminCurrencyController);
router.patch('/catalog/currencies/:id', updateAdminCurrencyController);
router.delete('/catalog/currencies/:id', deleteAdminCurrencyController);
router.post('/catalog/networks', createAdminNetworkController);
router.patch('/catalog/networks/:id', updateAdminNetworkController);
router.delete('/catalog/networks/:id', deleteAdminNetworkController);
router.post('/catalog/currency-networks', createAdminCurrencyNetworkController);
router.delete('/catalog/currency-networks/:currencyId/:networkId', deleteAdminCurrencyNetworkController);
router.get('/users', getAdminUsersController);
router.get('/users/:userId', getAdminUserController);
router.get('/users/:userId/transactions', getAdminUserTransactionsController);
router.get('/users/:userId/account-versions', getAdminUserAccountVersionsController);
router.get('/users/:userId/conversations', getAdminUserConversationsController);

export default router;
