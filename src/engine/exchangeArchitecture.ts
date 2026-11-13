import type { OrderRequest } from './types.ts';

export type ExchangeId = 'binance' | 'coinbase_advanced' | 'kraken' | 'bybit';

export interface ExchangeConnectorSpec {
  id: ExchangeId;
  name: string;
  status: 'DISCONNECTED_PAPER_ONLY';
  supportsWebSocketFeed: boolean;
  supportsSpotAndPerps: boolean;
  proxyEndpoint: string;
  authMode: 'SERVER_PROXY_HMAC_ONLY';
  requiredEnvVars: string[];
  liveExecutionEnabled: false;
}

export interface LiveExecutionGuardStatus {
  mode: 'SIMULATED_PAPER_ONLY';
  liveTradingAuthorized: false;
  serverProxyConfigured: boolean;
  frontendKeysAllowed: false;
  guardReason: string;
}

export const FUTURE_EXCHANGE_CONNECTORS: ExchangeConnectorSpec[] = [
  {
    id: 'binance',
    name: 'Binance Institutional API',
    status: 'DISCONNECTED_PAPER_ONLY',
    supportsWebSocketFeed: true,
    supportsSpotAndPerps: true,
    proxyEndpoint: '/api/exchange/binance/orders',
    authMode: 'SERVER_PROXY_HMAC_ONLY',
    requiredEnvVars: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
    liveExecutionEnabled: false,
  },
  {
    id: 'coinbase_advanced',
    name: 'Coinbase Advanced Trade',
    status: 'DISCONNECTED_PAPER_ONLY',
    supportsWebSocketFeed: true,
    supportsSpotAndPerps: false,
    proxyEndpoint: '/api/exchange/coinbase/orders',
    authMode: 'SERVER_PROXY_HMAC_ONLY',
    requiredEnvVars: ['COINBASE_KEY_NAME', 'COINBASE_PRIVATE_KEY'],
    liveExecutionEnabled: false,
  },
  {
    id: 'kraken',
    name: 'Kraken Pro REST / WS',
    status: 'DISCONNECTED_PAPER_ONLY',
    supportsWebSocketFeed: true,
    supportsSpotAndPerps: true,
    proxyEndpoint: '/api/exchange/kraken/orders',
    authMode: 'SERVER_PROXY_HMAC_ONLY',
    requiredEnvVars: ['KRAKEN_API_KEY', 'KRAKEN_PRIVATE_KEY'],
    liveExecutionEnabled: false,
  },
  {
    id: 'bybit',
    name: 'Bybit V5 Unified',
    status: 'DISCONNECTED_PAPER_ONLY',
    supportsWebSocketFeed: true,
    supportsSpotAndPerps: true,
    proxyEndpoint: '/api/exchange/bybit/orders',
    authMode: 'SERVER_PROXY_HMAC_ONLY',
    requiredEnvVars: ['BYBIT_API_KEY', 'BYBIT_API_SECRET'],
    liveExecutionEnabled: false,
  },
];

export function getLiveExecutionGuardStatus(): LiveExecutionGuardStatus {
  return {
    mode: 'SIMULATED_PAPER_ONLY',
    liveTradingAuthorized: false,
    serverProxyConfigured: false,
    frontendKeysAllowed: false,
    guardReason:
      'Live-money order routing is locked. Real exchange execution requires a server-side signing proxy (/api/exchange/*), server environment credentials, and explicit live-mode authorization.',
  };
}

export function attemptLiveOrderRoute(_exchange: ExchangeId, _order: OrderRequest): {
  accepted: false;
  reason: string;
} {
  return {
    accepted: false,
    reason:
      'Blocked by Phase 7 Live Trading Guard: 77 TRADE IT is operating in isolated Simulated Paper Mode. No live exchange order was transmitted.',
  };
}
