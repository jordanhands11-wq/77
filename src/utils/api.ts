import type { OrderRecord, OrderRequest, TradingEngineState } from '../engine/types.ts';
import { normalizeEngineState } from './storage.ts';

const AUTH_TOKEN_KEY = '77_trade_it_auth_token_v1';

export interface PublicUserProfile {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: 'TRADER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  baseCurrency: 'USD' | 'EUR' | 'GBP';
  emailVerified: boolean;
  bio: string;
  timezone: string;
  riskTier: string;
  createdAt: number;
  updatedAt: number;
}

export interface DatabaseHealthResponse {
  ok: boolean;
  driver: string;
  dbPath: string;
  tablesCount: number;
  usersCount: number;
  savedPortfoliosCount: number;
  ledgerTransactionsCount: number;
  serverTime: number;
  liveTradingAuthorized: boolean;
  mode: string;
  smtpConfigured?: boolean;
}

export interface AuthResponse {
  user: PublicUserProfile;
  token: string;
  tradingState: TradingEngineState;
  verificationToken?: string;
  emailDeliveryMode?: string;
}

export interface LedgerTransactionRecord {
  id: string;
  userId: string;
  userEmail?: string;
  asset: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  txType:
    | 'VIRTUAL_DEPOSIT'
    | 'SIMULATED_WITHDRAWAL'
    | 'WALLET_WITHDRAWAL_RESERVE'
    | 'WALLET_WITHDRAWAL_RELEASE'
    | 'VIRTUAL_RESET'
    | 'ORDER_FILL'
    | 'ORDER_RESERVE'
    | 'ORDER_CANCEL_RELEASE'
    | 'POSITION_SETTLEMENT';
  referenceId: string | null;
  idempotencyKey: string | null;
  description: string;
  mode: 'SIMULATED_PAPER';
  createdAt: number;
}

export type WalletAsset =
  | 'USDT'
  | 'BTC'
  | 'ETH'
  | 'SOL'
  | 'BNB'
  | 'XRP'
  | 'AVAX'
  | 'LINK'
  | 'ADA';

export type PaymentRailType =
  | 'SIMULATED_INTERNAL'
  | 'BANK_TRANSFER_SEPA_ACH'
  | 'CARD_GATEWAY';

export type WalletTransactionStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

export interface SimulatedDepositInstruction {
  referenceCode: string;
  providerId: string;
  providerName: string;
  railType: PaymentRailType;
  asset: WalletAsset;
  networkOrChannel: string;
  simulatedDestination: string;
  memoTag: string;
  expiresAt: number;
  disclaimer: string;
  liveProcessingEnabled: false;
}

export interface PublicPaymentProviderInfo {
  id: string;
  name: string;
  railType: PaymentRailType;
  description: string;
  status: 'SIMULATED_SANDBOX_ONLY' | 'DISCONNECTED_PAPER_ONLY';
  configuredOnServer: boolean;
  liveProcessingEnabled: false;
  requiredServerEnvVars: string[];
  supportedAssets: WalletAsset[];
}

export interface WalletAssetBalanceRecord {
  asset: WalletAsset;
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
  estimatedUsdPrice: number;
  estimatedUsdValue: number;
  updatedAt: number;
}

export interface WalletTransactionRecord {
  id: string;
  userId: string;
  userEmail?: string;
  walletUid: string;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  asset: WalletAsset;
  amount: number;
  usdEquivalent: number;
  fee: number;
  netAmount: number;
  providerId: string;
  providerName: string;
  paymentRail: PaymentRailType;
  destinationOrSource: string;
  referenceCode: string;
  idempotencyKey: string;
  status: WalletTransactionStatus;
  note: string;
  rejectionReason: string | null;
  instruction: SimulatedDepositInstruction | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  mode: 'SIMULATED_PAPER';
  createdAt: number;
  updatedAt: number;
}

export interface SuspiciousActivityAlertRecord {
  id: string;
  userId: string;
  userEmail: string;
  transactionId: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  ruleCode: string;
  description: string;
  status: 'OPEN' | 'RESOLVED';
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
}

export interface UserWalletSummary {
  walletUid: string;
  userId: string;
  status: 'ACTIVE' | 'FROZEN';
  mode: 'SIMULATED_PAPER_ONLY';
  totalWalletUsdValue: number;
  totalOpenPositionsUsdValue: number;
  totalPortfolioUsdValue: number;
  availableUsdt: number;
  reservedUsdtForOrders: number;
  reservedUsdtForWithdrawals: number;
  dailyWithdrawalUsedUsd: number;
  dailyWithdrawalLimitUsd: number;
  maxSingleWithdrawalUsd: number;
  maxSingleDepositUsd: number;
  withdrawalApprovalThresholdUsd: number;
  requireAdminApprovalForTransfers: boolean;
  assets: WalletAssetBalanceRecord[];
  transactions: WalletTransactionRecord[];
  updatedAt: number;
}

export interface TradingPairConfig {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  tickSize: number;
  minQty: number;
  enabled: boolean;
  makerFeeRate: number;
  takerFeeRate: number;
  updatedAt: number;
}

export interface PlatformSettingsRecord {
  allowNewRegistrations: boolean;
  tradingEnabled: boolean;
  maxSimulatedDeposit: number;
  maxSimulatedWithdrawal: number;
  dailySimulatedWithdrawalLimit: number;
  withdrawalApprovalThreshold: number;
  requireAdminApprovalForTransfers: boolean;
  maintenanceNotice: string;
  updatedBy: string | null;
  updatedAt: number;
}

export interface AdminOverviewResponse {
  overview: {
    usersTotal: number;
    activeUsers: number;
    suspendedUsers: number;
    adminUsers: number;
    activeSessions: number;
    ordersTotal: number;
    completedTradesTotal: number;
    ledgerTransactionsTotal: number;
    totalSimulatedPaperCash: number;
    settings: PlatformSettingsRecord;
  };
  pairs: TradingPairConfig[];
}

export interface AdminUserRow extends PublicUserProfile {
  availableCash: number;
  reservedCash: number;
  openOrdersCount: number;
  completedTradesCount: number;
}

export interface AdminOrderRow {
  id: string;
  userId: string;
  userEmail: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: number;
  requestedPrice: number;
  executedPrice: number | null;
  fee: number;
  status: string;
  createdAt: number;
}

export interface AdminAuditLogRow {
  id: string;
  actorUserId: string | null;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: number;
}

export function getStoredAuthToken(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage error
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredAuthToken();
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Unexpected response from server (${res.status}).`);
    }
  }

  if (!res.ok) {
    const errMsg =
      typeof parsed.error === 'string'
        ? parsed.error
        : Array.isArray(parsed.errors) && typeof parsed.errors[0] === 'string'
          ? parsed.errors[0]
          : `Request failed with status ${res.status}.`;
    throw new Error(errMsg);
  }

  return parsed as T;
}

export async function apiGetHealth(): Promise<DatabaseHealthResponse> {
  return apiFetch<DatabaseHealthResponse>('/api/health');
}

export async function apiRegister(input: {
  email: string;
  password: string;
  displayName: string;
  handle?: string;
  startingBalance?: number;
}): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setStoredAuthToken(res.token);
  const normalized = normalizeEngineState(res.tradingState);
  return {
    ...res,
    tradingState: normalized ?? res.tradingState,
  };
}

export async function apiLogin(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setStoredAuthToken(res.token);
  const normalized = normalizeEngineState(res.tradingState);
  return {
    ...res,
    tradingState: normalized ?? res.tradingState,
  };
}

export async function apiLogout(): Promise<void> {
  try {
    await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  } finally {
    setStoredAuthToken(null);
  }
}

export async function apiGetMe(): Promise<{
  authenticated: boolean;
  user: PublicUserProfile | null;
}> {
  return apiFetch<{ authenticated: boolean; user: PublicUserProfile | null }>('/api/auth/me');
}

export async function apiRequestEmailVerification(): Promise<{
  sent: true;
  previewToken?: string;
  deliveryMode: string;
}> {
  return apiFetch('/api/auth/request-verification', { method: 'POST' });
}

export async function apiVerifyEmail(token: string): Promise<{ ok: true; user: PublicUserProfile }> {
  return apiFetch('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function apiForgotPassword(email: string): Promise<{
  accepted: true;
  previewToken?: string;
  deliveryMode: string;
}> {
  return apiFetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function apiResetPassword(input: {
  token: string;
  newPassword: string;
}): Promise<{ reset: true }> {
  return apiFetch('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function apiUpdateProfile(patch: {
  displayName?: string;
  handle?: string;
  baseCurrency?: 'USD' | 'EUR' | 'GBP';
  bio?: string;
  timezone?: string;
}): Promise<PublicUserProfile> {
  const res = await apiFetch<{ user: PublicUserProfile }>('/api/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.user;
}

export async function apiGetTradingState(): Promise<{
  state: TradingEngineState;
  updatedAt: number;
}> {
  const res = await apiFetch<{ state: TradingEngineState; updatedAt: number }>(
    '/api/trading/state'
  );
  const normalized = normalizeEngineState(res.state);
  return {
    state: normalized ?? res.state,
    updatedAt: res.updatedAt,
  };
}

export async function apiSaveTradingState(
  state: TradingEngineState
): Promise<{ saved: true; updatedAt: number }> {
  return apiFetch<{ saved: true; updatedAt: number }>('/api/trading/state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  });
}

export async function apiResetTradingState(
  startingBalance: number
): Promise<{ state: TradingEngineState; updatedAt: number }> {
  const res = await apiFetch<{ state: TradingEngineState; updatedAt: number }>(
    '/api/trading/reset',
    {
      method: 'POST',
      body: JSON.stringify({ startingBalance }),
    }
  );
  const normalized = normalizeEngineState(res.state);
  return {
    state: normalized ?? res.state,
    updatedAt: res.updatedAt,
  };
}

export async function apiPlaceServerOrder(
  req: OrderRequest,
  idempotencyKey?: string
): Promise<{
  accepted: boolean;
  errors: string[];
  order?: OrderRecord;
  state: TradingEngineState;
  updatedAt: number;
  transactionId: string | null;
}> {
  const res = await apiFetch<{
    accepted: boolean;
    errors: string[];
    order?: OrderRecord;
    state: TradingEngineState;
    updatedAt: number;
    transactionId: string | null;
  }>('/api/trading/orders', {
    method: 'POST',
    body: JSON.stringify({ ...req, idempotencyKey }),
  });
  const normalized = normalizeEngineState(res.state);
  return {
    ...res,
    state: normalized ?? res.state,
  };
}

export async function apiCancelServerOrder(orderId: string): Promise<{
  ok: true;
  orderId: string;
  state: TradingEngineState;
  updatedAt: number;
}> {
  const res = await apiFetch<{
    ok: true;
    orderId: string;
    state: TradingEngineState;
    updatedAt: number;
  }>(`/api/trading/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  });
  const normalized = normalizeEngineState(res.state);
  return {
    ...res,
    state: normalized ?? res.state,
  };
}

export async function apiGetTradingLedger(limit = 150): Promise<{
  mode: string;
  transactions: LedgerTransactionRecord[];
}> {
  return apiFetch(`/api/trading/ledger?limit=${limit}`);
}

export async function apiExecuteSimulatedTransfer(input: {
  direction: 'SIMULATED_DEPOSIT' | 'SIMULATED_WITHDRAWAL';
  amount: number;
  note?: string;
  idempotencyKey?: string;
}): Promise<{
  ledgerEntry: LedgerTransactionRecord;
  state: TradingEngineState;
  updatedAt: number;
}> {
  const res = await apiFetch<{
    ledgerEntry: LedgerTransactionRecord;
    state: TradingEngineState;
    updatedAt: number;
  }>('/api/trading/transfers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const normalized = normalizeEngineState(res.state);
  return {
    ...res,
    state: normalized ?? res.state,
  };
}

// ---- Admin APIs ----
export async function apiGetAdminOverview(): Promise<AdminOverviewResponse> {
  return apiFetch<AdminOverviewResponse>('/api/admin/overview');
}

export async function apiListAdminUsers(): Promise<{ users: AdminUserRow[] }> {
  return apiFetch('/api/admin/users');
}

export async function apiAdminUpdateUser(
  userId: string,
  patch: { status?: 'ACTIVE' | 'SUSPENDED'; role?: 'TRADER' | 'ADMIN'; emailVerified?: boolean }
): Promise<{ user: PublicUserProfile }> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function apiListAdminOrders(limit = 120): Promise<{ orders: AdminOrderRow[] }> {
  return apiFetch(`/api/admin/orders?limit=${limit}`);
}

export async function apiListAdminTransactions(
  limit = 150
): Promise<{ transactions: LedgerTransactionRecord[] }> {
  return apiFetch(`/api/admin/transactions?limit=${limit}`);
}

export async function apiUpdateAdminPair(
  symbol: string,
  patch: { enabled?: boolean; makerFeeRate?: number; takerFeeRate?: number }
): Promise<{ pair: TradingPairConfig }> {
  return apiFetch(`/api/admin/pairs/${encodeURIComponent(symbol)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function apiUpdateAdminSettings(
  patch: Partial<Omit<PlatformSettingsRecord, 'updatedBy' | 'updatedAt'>>
): Promise<{ settings: PlatformSettingsRecord }> {
  return apiFetch('/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function apiListAdminAuditLogs(limit = 120): Promise<{ logs: AdminAuditLogRow[] }> {
  return apiFetch(`/api/admin/audit-logs?limit=${limit}`);
}

// ---- Phase 5: User Wallet, Deposits, Withdrawals & Payment Providers ----
export async function apiGetWallet(): Promise<{
  mode: string;
  liveProcessingEnabled: boolean;
  wallet: UserWalletSummary;
  providers: PublicPaymentProviderInfo[];
}> {
  return apiFetch('/api/wallet');
}

export async function apiGetPaymentProviders(): Promise<{
  mode: string;
  liveProcessingEnabled: boolean;
  providers: PublicPaymentProviderInfo[];
}> {
  return apiFetch('/api/wallet/providers');
}

export async function apiCreateSimulatedDeposit(input: {
  asset: WalletAsset;
  amount: number;
  providerId: string;
  note?: string;
  idempotencyKey?: string;
  requestManualReview?: boolean;
}): Promise<{
  mode: string;
  liveProcessingEnabled: boolean;
  transaction: WalletTransactionRecord;
  wallet: UserWalletSummary;
  state: TradingEngineState;
}> {
  const res = await apiFetch<{
    mode: string;
    liveProcessingEnabled: boolean;
    transaction: WalletTransactionRecord;
    wallet: UserWalletSummary;
    state: TradingEngineState;
  }>('/api/wallet/deposits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const normalized = normalizeEngineState(res.state);
  return {
    ...res,
    state: normalized ?? res.state,
  };
}

export async function apiCreateSimulatedWithdrawal(input: {
  asset: WalletAsset;
  amount: number;
  destination: string;
  providerId: string;
  confirmed: boolean;
  note?: string;
  idempotencyKey?: string;
  requestManualReview?: boolean;
}): Promise<{
  mode: string;
  liveProcessingEnabled: boolean;
  transaction: WalletTransactionRecord;
  wallet: UserWalletSummary;
  state: TradingEngineState;
}> {
  const res = await apiFetch<{
    mode: string;
    liveProcessingEnabled: boolean;
    transaction: WalletTransactionRecord;
    wallet: UserWalletSummary;
    state: TradingEngineState;
  }>('/api/wallet/withdrawals', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const normalized = normalizeEngineState(res.state);
  return {
    ...res,
    state: normalized ?? res.state,
  };
}

export async function apiListAdminWalletTransactions(
  status?: string,
  limit = 150
): Promise<{ transactions: WalletTransactionRecord[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}&limit=${limit}` : `?limit=${limit}`;
  return apiFetch(`/api/admin/wallet/transactions${qs}`);
}

export async function apiAdminReviewWalletTransaction(
  txId: string,
  input: { decision: 'APPROVE' | 'COMPLETE' | 'REJECT'; reason?: string }
): Promise<{ transaction: WalletTransactionRecord }> {
  return apiFetch(`/api/admin/wallet/transactions/${encodeURIComponent(txId)}/review`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function apiListAdminSuspiciousAlerts(
  limit = 120
): Promise<{ alerts: SuspiciousActivityAlertRecord[] }> {
  return apiFetch(`/api/admin/wallet/alerts?limit=${limit}`);
}

export async function apiResolveAdminSuspiciousAlert(
  alertId: string
): Promise<{ alert: SuspiciousActivityAlertRecord }> {
  return apiFetch(`/api/admin/wallet/alerts/${encodeURIComponent(alertId)}/resolve`, {
    method: 'POST',
  });
}
