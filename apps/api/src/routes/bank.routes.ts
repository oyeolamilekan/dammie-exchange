import express from 'express';
import { getBankCatalogController } from '../controllers/bank.controller';

const router = express.Router();

/** Public read-only provider bank directory. */
router.get('/', getBankCatalogController);

export default router;
