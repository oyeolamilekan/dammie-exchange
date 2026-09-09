import asyncHandler from '../helpers/async-handler.helper';
import { findBankCatalog } from '../queries/bank-catalog.query';

/** Returns the provider bank directory for customer-facing selectors. */
export const getBankCatalogController = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Banks retrieved successfully',
    data: await findBankCatalog(),
  });
});
