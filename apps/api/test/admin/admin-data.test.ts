import { describe, expect, it } from 'vitest';
import { normalizeAdminEmail } from '../../src/queries/admin-auth.query';
import {
  groupAdminConversationTurns,
  normalizeAdminUserSearch,
  paginateAdminTransactions,
  type AdminTransaction,
} from '../../src/queries/admin-data.query';
import { decodeTransactionCursor } from '../../src/queries/cursor-pagination';

const transaction = (
  id: string,
  createdAt: string,
  type: AdminTransaction['type'],
): AdminTransaction => ({
  id,
  type,
  status: 'success',
  createdAt: new Date(createdAt),
  sourceAmount: '10.125',
  sourceCurrency: 'USDT',
  destinationAmount: null,
  destinationCurrency: null,
  reference: `ref-${id}`,
});

describe('admin data normalization', () => {
  it('normalizes admin emails and user search input', () => {
    expect(normalizeAdminEmail('  OPS@Example.COM ')).toBe('ops@example.com');
    expect(normalizeAdminUserSearch('  Ada Nwosu ')).toBe('Ada Nwosu');
    expect(normalizeAdminUserSearch('   ')).toBeUndefined();
  });

  it('unifies transaction families in stable created-at/id order and emits a cursor', () => {
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
    ];
    const page = paginateAdminTransactions([
      transaction(ids[0], '2026-09-05T10:00:00Z', 'deposit'),
      transaction(ids[1], '2026-09-05T11:00:00Z', 'swap'),
      transaction(ids[2], '2026-09-05T11:00:00Z', 'withdrawal'),
    ], 2);
    expect(page.items.map((item) => item.id)).toEqual([ids[1], ids[2]]);
    expect(page.items.map((item) => item.type)).toEqual(['swap', 'withdrawal']);
    expect(page.items[0].sourceAmount).toBe('10.125');
    expect(decodeTransactionCursor(page.nextCursor!)).toEqual({
      createdAt: new Date('2026-09-05T11:00:00Z'),
      id: ids[2],
    });
  });

  it('groups messages by turn and guarantees chronological order within each turn', () => {
    const turnId = '00000000-0000-4000-8000-000000000001';
    const otherTurnId = '00000000-0000-4000-8000-000000000002';
    const grouped = groupAdminConversationTurns([
      { turnId, createdAt: new Date('2026-09-05T12:00:00Z') },
      { turnId: otherTurnId, createdAt: new Date('2026-09-05T11:00:00Z') },
    ], [
      { id: 'b', turnId, role: 'assistant', content: 'Second', createdAt: new Date('2026-09-05T12:00:02Z') },
      { id: 'a', turnId, role: 'user', content: 'First', createdAt: new Date('2026-09-05T12:00:01Z') },
      { id: 'c', turnId: otherTurnId, role: 'user', content: 'Other', createdAt: new Date('2026-09-05T11:00:01Z') },
    ]);
    expect(grouped.map((turn) => turn.turnId)).toEqual([turnId, otherTurnId]);
    expect(grouped[0].messages.map((message) => message.content)).toEqual(['First', 'Second']);
    expect(grouped[1].messages).toHaveLength(1);
  });
});

