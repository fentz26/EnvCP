import { VERSION } from '../version.js';

export const TOOLS_MESSAGE = 'EnvCP tools available. Use function calling to interact with environment variables.';

/**
 * Build the common envelope fields for an OpenAI-style chat.completion response.
 * The caller fills in the first choice message and finish_reason.
 */
export function buildChatCompletionBase(
  message: Record<string, unknown>,
  finishReason: string,
): Record<string, unknown> {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: `envcp-${VERSION}`,
    choices: [{ index: 0, message, finish_reason: finishReason }],
  };
}
