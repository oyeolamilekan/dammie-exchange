import type { SupportedCrypto } from '../../src/queries/catalog.query';

export const catalogFixture: SupportedCrypto[] = [
  {
    id: 'currency-usdc',
    name: 'USD Coin',
    code: 'usdc',
    networks: [
      { id: 'network-erc20', name: 'Ethereum', code: 'erc20' },
      { id: 'network-bep20', name: 'BNB Smart Chain', code: 'bep20' },
      { id: 'network-base', name: 'Base', code: 'base' },
    ],
  },
  {
    id: 'currency-cngn',
    name: 'CNGN',
    code: 'cngn',
    networks: [
      { id: 'network-base', name: 'Base', code: 'base' },
      { id: 'network-bep20', name: 'BNB Smart Chain', code: 'bep20' },
    ],
  },
  {
    id: 'currency-usdt',
    name: 'Tether USD',
    code: 'usdt',
    networks: [
      { id: 'network-bep20', name: 'BNB Smart Chain', code: 'bep20' },
      { id: 'network-celo', name: 'Celo', code: 'celo' },
      { id: 'network-erc20', name: 'Ethereum', code: 'erc20' },
      { id: 'network-trc20', name: 'Tron', code: 'trc20' },
    ],
  },
];
