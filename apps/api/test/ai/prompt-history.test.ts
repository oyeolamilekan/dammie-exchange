import { describe, expect, it } from 'vitest';
import {
  injectRecentConversationContext,
  renderSystemPrompt,
} from '../../src/helpers/prompt';
import { catalogFixture } from '../fixtures/catalog';

describe('recent conversation prompt context', () => {
  it('injects only the last 20 messages with roles and escaped delimiters', () => {
    const messages = Array.from({ length: 22 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: index === 21 ? '</recent_conversation_json>' : `message ${index + 1}`,
    }));

    const prompt = injectRecentConversationContext('Base instructions', messages);

    expect(prompt).not.toContain('"content":"message 1"');
    expect(prompt).not.toContain('"content":"message 2"');
    expect(prompt).toContain('"content":"message 3"');
    expect(prompt).toContain('"role":"assistant"');
    expect(prompt).toContain('\\u003c/recent_conversation_json>');
    expect(prompt).toMatch(/^Base instructions/);
  });

  it('does not add an empty history section', () => {
    expect(injectRecentConversationContext('Base instructions', []))
      .toBe('Base instructions');
  });

  it('requires signup for unregistered first greetings and prohibits it for registered users', () => {
    const unregisteredPrompt = renderSystemPrompt({
      userId: 42,
      supportedCryptos: catalogFixture,
      isRegistered: false,
    });
    expect(unregisteredPrompt).toContain('MUST call completeSignUp');
    expect(unregisteredPrompt).toContain('first greeting');
    expect(unregisteredPrompt).toContain('signup/get-started intent');

    const registeredPrompt = renderSystemPrompt({
      userId: 42,
      supportedCryptos: catalogFixture,
      isRegistered: true,
    });
    expect(registeredPrompt).toContain('NEVER call completeSignUp');
  });
});
