/** Adds one provider lifecycle response while preserving responses already recorded for the transaction. */
export const appendProviderResponse = (
  current: unknown,
  stage: string,
  response: unknown,
): Record<string, unknown> => {
  const existing = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return { ...existing, [stage]: response };
};
