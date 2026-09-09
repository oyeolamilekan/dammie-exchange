/**
 * Keep browser requests on the same-origin API proxy by default.
 *
 * Environment files are intentionally not committed, so deployments that do
 * not override this value must still call `/api/v1` instead of resolving API
 * paths relative to the current page (for example `/bank/:slug/banks`).
 */
export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
