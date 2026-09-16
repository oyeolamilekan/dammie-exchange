/**
 * The API base URL used by every browser request, including the admin client.
 * Keep the version prefix in the environment value so callers can append
 * endpoint paths without separate proxy configuration.
 */
const configuredBaseUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const developmentFallback =
  process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:3001/api/v1"
    : undefined;

if (!configuredBaseUrl && !developmentFallback) {
  throw new Error("NEXT_PUBLIC_API_URL is required in production");
}

export const BASE_URL = (configuredBaseUrl || developmentFallback!).replace(/\/+$/, "");
