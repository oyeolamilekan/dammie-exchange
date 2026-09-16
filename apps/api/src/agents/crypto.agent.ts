import { isStepCount, ToolLoopAgent, type LanguageModel } from 'ai';
import CONFIG from '../config/config';
import {
  findSupportedCryptos,
  type SupportedCrypto,
} from '../queries/catalog.query';
import { createCryptoTools, type CryptoAgentDependencies, type CryptoTools } from './crypto.tools';
import type {
  CryptoAgentResponse,
  CryptoToolOutput,
  CryptoUserContext,
} from './crypto.types';

export {
  createAccountHistorySchema,
  createCryptoSchemas,
  createSwapInputSchema,
  createTransactionFilterSchema,
} from './crypto.schemas';
export type { CryptoSchemas } from './crypto.schemas';
export { createCryptoTools, normalizeToolOutput } from './crypto.tools';
export type { CryptoAgentDependencies, CryptoTools } from './crypto.tools';
export type {
  CryptoAction,
  CryptoAgentResponse,
  CryptoToolOutput,
  CryptoUserContext,
} from './crypto.types';

export interface CryptoAgentOptions {
  model?: LanguageModel;
  dependencies?: Partial<CryptoAgentDependencies>;
  supportedCryptos?: readonly SupportedCrypto[];
  /** Backwards-compatible alias for supportedCryptos. */
  catalog?: readonly SupportedCrypto[];
}

export function createCryptoAgent(
  context: CryptoUserContext,
  instructions: string,
  options: CryptoAgentOptions = {},
) {
  const catalog = options.supportedCryptos ?? options.catalog ?? [];
  return new ToolLoopAgent<never, CryptoTools>({
    model: options.model ?? CONFIG.AI_MODEL,
    instructions,
    stopWhen: isStepCount(5),
    tools: createCryptoTools(context, catalog, options.dependencies),
  });
}

const isCryptoToolOutput = (output: unknown): output is CryptoToolOutput =>
  typeof output === 'object'
  && output !== null
  && 'message' in output
  && typeof output.message === 'string';

const findLastOutput = (
  outputs: CryptoToolOutput[],
  predicate: (output: CryptoToolOutput) => boolean,
): CryptoToolOutput | undefined => {
  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    if (predicate(outputs[index])) return outputs[index];
  }
  return undefined;
};

const selectResponse = (
  generatedText: string,
  outputs: CryptoToolOutput[],
): CryptoAgentResponse => {
  const lastOutput = outputs[outputs.length - 1];
  const actionOutput = findLastOutput(outputs, (output) => Boolean(output.action));
  const deterministicOutput = findLastOutput(
    outputs,
    (output) => Boolean(output.deterministic),
  );
  const selectedOutput = deterministicOutput ?? actionOutput;

  return {
    text: selectedOutput?.message
      || generatedText.trim()
      || lastOutput?.message
      || '',
    // Deterministic signup output owns its action so the welcome text and
    // Mini App link can never be split across separate tool results. Keep
    // the existing action fallback for deterministic tools without actions.
    action: deterministicOutput?.action ?? actionOutput?.action,
  };
};

export async function runCryptoAgent(
  context: CryptoUserContext & { prompt: string; instructions: string },
  options: CryptoAgentOptions = {},
): Promise<CryptoAgentResponse> {
  const catalog = options.supportedCryptos
    ?? options.catalog
    ?? await findSupportedCryptos();
  const agent = createCryptoAgent(context, context.instructions, {
    ...options,
    supportedCryptos: catalog,
  });
  const result = await agent.generate({ prompt: context.prompt });
  const outputs = result.steps
    .flatMap(({ toolResults }) => toolResults)
    .map(({ output }) => output)
    .filter(isCryptoToolOutput);

  return selectResponse(result.text, outputs);
}
