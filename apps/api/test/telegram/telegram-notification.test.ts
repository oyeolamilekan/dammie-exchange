import { describe, expect, it, vi } from 'vitest';
import Logging from '../../src/library/logging.utils';
import { sendTelegramNotification } from '../../src/services/telegram/notifications';
import type { TelegramClient } from '../../src/services/telegram/client';

const createClient = (sendMessage: TelegramClient['sendMessage']): TelegramClient => ({
  onMessage: vi.fn(),
  onError: vi.fn(),
  sendMessage,
  sendChatAction: vi.fn(),
  sendPhoto: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  isRunning: vi.fn(),
});

describe('sendTelegramNotification', () => {
  it('reports successful best-effort delivery', async () => {
    const client = createClient(vi.fn().mockResolvedValue(undefined));

    await expect(
      sendTelegramNotification(client, 42, 'completed'),
    ).resolves.toBe(true);
  });

  it('contains delivery failures without logging payloads or identities', async () => {
    const warning = vi.spyOn(Logging, 'warning').mockImplementation(() => undefined);
    const client = createClient(
      vi.fn().mockRejectedValue(new Error('secret provider response')),
    );

    await expect(
      sendTelegramNotification(client, 42, 'sensitive balance text'),
    ).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith('Telegram notification delivery failed');
    expect(warning.mock.calls.flat().join(' ')).not.toContain('42');
    expect(warning.mock.calls.flat().join(' ')).not.toContain('sensitive');
    expect(warning.mock.calls.flat().join(' ')).not.toContain('secret');
  });
});
