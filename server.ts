import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createInitialEngineState } from './src/engine/tradingEngine.ts';
import type { OrderRequest, Timeframe, TradingEngineState } from './src/engine/types.ts';
import {
  defaultStore,
  DuplicateTransactionError,
  PermissionDeniedError,
  PersistentStore,
  type AccountStatus,
  type PublicUserProfile,
  type UserRole,
} from './src/server/db.ts';
import {
  MarketFeedService,
  SUPPORTED_CRYPTO_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
} from './src/server/marketFeed.ts';
import { paymentRegistry } from './src/server/paymentInfrastructure.ts';

const SESSION_COOKIE_NAME = 'tradeit77_session';

export interface CreateAppOptions {
  authRateLimitMax?: number;
  authRateLimitWindowMs?: number;
  apiRateLimitMax?: number;
  marketFetch?: typeof fetch;
  marketDataTimeoutMs?: number;
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] ?? null;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 64);
}

function createRateLimiter(windowMs: number, maxRequests: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${getClientIp(req)}:${req.baseUrl || req.path}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || now > existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      const retrySec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      res.status(429).json({
        error: 'Rate limit exceeded. Please wait briefly before retrying.',
        retryAfterSeconds: retrySec,
      });
      return;
    }
    existing.count += 1;
    next();
  };
}

function safeErrorLog(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : 'Unknown internal error';
  console.error(`[77-TRADE-IT][${context}] ${msg}`);
}

export function createApp(store: PersistentStore = defaultStore, options: CreateAppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  const generalLimiter = createRateLimiter(60_000, options.apiRateLimitMax ?? 300);
  const authLimiter = createRateLimiter(
    options.authRateLimitWindowMs ?? 60_000,
    options.authRateLimitMax ?? 40
  );
  const marketFeed = new MarketFeedService({
    fetchFn: options.marketFetch,
    timeoutMs: options.marketDataTimeoutMs,
  });
  app.use('/api', generalLimiter);

  const requireUserId = (req: Request, res: Response): string | null => {
    const token = extractAuthToken(req);
    const userId = token ? store.verifySessionToken(token) : null;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return null;
    }
    return userId;
  };

  const requireAdmin = (req: Request, res: Response): PublicUserProfile | null => {
    const userId = requireUserId(req, res);
    if (!userId) return null;
    const user = store.getPublicUserById(userId);
    if (!user || user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Account inactive or suspended.' });
      return null;
    }
    if (user.role !== 'ADMIN') {
      store.recordSecurityAuditEvent({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'UNAUTHORIZED_ADMIN_ACCESS',
        targetType: 'ADMIN_ROUTE',
        targetId: req.originalUrl,
        details: { method: req.method },
        ipAddress: getClientIp(req),
      });
      res.status(403).json({ error: 'Forbidden: administrator permissions required.' });
      return null;
    }
    return user;
  };

  // Health & DB verification
  app.get('/api/health', (_req, res) => {
    const health = store.getDatabaseHealth();
    res.json({
      ...health,
      liveTradingAuthorized: false,
      mode: 'SIMULATED_PAPER_ONLY',
      smtpConfigured: Boolean(process.env.SMTP_HOST),
    });
  });

  // Public Platform Status (safe non-sensitive settings)
  app.get('/api/platform/status', (_req, res) => {
    const settings = store.getPlatformSettings();
    const pairs = store.listTradingPairs();
    res.json({
      mode: 'SIMULATED_PAPER_ONLY',
      allowNewRegistrations: settings.allowNewRegistrations,
      tradingEnabled: settings.tradingEnabled,
      maxSimulatedDeposit: settings.maxSimulatedDeposit,
      maxSimulatedWithdrawal: settings.maxSimulatedWithdrawal,
      dailySimulatedWithdrawalLimit: settings.dailySimulatedWithdrawalLimit,
      withdrawalApprovalThreshold: settings.withdrawalApprovalThreshold,
      requireAdminApprovalForTransfers: settings.requireAdminApprovalForTransfers,
      maintenanceNotice: settings.maintenanceNotice,
      enabledPairsCount: pairs.filter((p) => p.enabled).length,
      disabledSymbols: pairs.filter((p) => !p.enabled).map((p) => p.symbol),
    });
  });

  // Auth: Register
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
      const { email, password, displayName, handle, startingBalance } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string' || typeof displayName !== 'string') {
        res.status(400).json({ error: 'Email, display name, and password are required.' });
        return;
      }
      const created = await store.registerUser({
        email,
        password,
        displayName,
        handle: typeof handle === 'string' ? handle : undefined,
        startingBalance: typeof startingBalance === 'number' ? startingBalance : undefined,
      });
      setSessionCookie(res, created.token);
      res.status(201).json({
        ...created,
        emailDeliveryMode: process.env.SMTP_HOST ? 'SMTP' : 'LOCAL_DEV_PREVIEW',
      });
    } catch (err) {
      safeErrorLog('auth.register', err);
      const message = err instanceof Error ? err.message : 'Unable to register account.';
      res.status(400).json({ error: message });
    }
  });

  // Auth: Login
  app.post('/api/auth/login', authLimiter, (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }
      const result = store.authenticateUser(
        { email, password },
        {
          userAgent: req.headers['user-agent'],
          ipAddress: getClientIp(req),
        }
      );
      setSessionCookie(res, result.token);
      res.json(result);
    } catch (err) {
      safeErrorLog('auth.login', err);
      if (err instanceof PermissionDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Invalid credentials.';
      res.status(401).json({ error: message });
    }
  });

  // Auth: Logout (revokes server session token + clears cookie)
  app.post('/api/auth/logout', (req, res) => {
    const token = extractAuthToken(req);
    if (token) {
      store.revokeSessionToken(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  // Auth: Current Session User
  app.get('/api/auth/me', (req, res) => {
    const token = extractAuthToken(req);
    const userId = token ? store.verifySessionToken(token) : null;
    if (!userId) {
      res.json({ authenticated: false, user: null });
      return;
    }
    const user = store.getPublicUserById(userId);
    if (!user || user.status !== 'ACTIVE') {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({ authenticated: true, user });
  });

  // Auth: Request Email Verification Token
  app.post('/api/auth/request-verification', authLimiter, (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const result = store.requestEmailVerification(userId);
      res.json({
        ...result,
        deliveryMode: process.env.SMTP_HOST ? 'SMTP' : 'LOCAL_DEV_PREVIEW',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to request verification.';
      res.status(400).json({ error: message });
    }
  });

  // Auth: Verify Email Token
  app.post('/api/auth/verify-email', authLimiter, (req, res) => {
    try {
      const token = req.body?.token;
      if (typeof token !== 'string' || !token.trim()) {
        res.status(400).json({ error: 'Verification token is required.' });
        return;
      }
      const user = store.verifyEmailWithToken(token);
      res.json({ ok: true, user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Email verification failed.';
      res.status(400).json({ error: message });
    }
  });

  // Auth: Request Password Reset
  app.post('/api/auth/forgot-password', authLimiter, (req, res) => {
    try {
      const email = req.body?.email;
      if (typeof email !== 'string' || !email.trim()) {
        res.status(400).json({ error: 'Email address is required.' });
        return;
      }
      const result = store.requestPasswordReset(email);
      res.json({
        ...result,
        deliveryMode: process.env.SMTP_HOST ? 'SMTP' : 'LOCAL_DEV_PREVIEW',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to initiate password reset.';
      res.status(400).json({ error: message });
    }
  });

  // Auth: Reset Password with Token
  app.post('/api/auth/reset-password', authLimiter, (req, res) => {
    try {
      const { token, newPassword } = req.body ?? {};
      if (typeof token !== 'string' || typeof newPassword !== 'string') {
        res.status(400).json({ error: 'Reset token and new password are required.' });
        return;
      }
      const result = store.resetPasswordWithToken(token, newPassword);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reset password.';
      res.status(400).json({ error: message });
    }
  });

  // Profile: Update
  app.patch('/api/profile', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const { displayName, handle, baseCurrency, bio, timezone } = req.body ?? {};
      const updated = await store.updateUserProfile(userId, {
        displayName: typeof displayName === 'string' ? displayName : undefined,
        handle: typeof handle === 'string' ? handle : undefined,
        baseCurrency,
        bio: typeof bio === 'string' ? bio : undefined,
        timezone: typeof timezone === 'string' ? timezone : undefined,
      });
      res.json({ user: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update profile.';
      res.status(400).json({ error: message });
    }
  });

  // Trading State: Load
  app.get('/api/trading/state', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const saved = store.getUserTradingState(userId);
    if (!saved) {
      const fallback = createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
      res.json({ state: fallback, updatedAt: Date.now() });
      return;
    }
    res.json(saved);
  });

  // Trading State: Save
  app.put('/api/trading/state', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const state = req.body?.state as TradingEngineState;
      const result = await store.saveUserTradingState(userId, state);
      res.json(result);
    } catch (err) {
      safeErrorLog('trading.saveState', err);
      const message = err instanceof Error ? err.message : 'Failed to save trading state.';
      res.status(400).json({ error: message });
    }
  });

  // Trading State: Reset paper account
  app.post('/api/trading/reset', async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const balance = Number(req.body?.startingBalance) || 100_000;
      const result = store.resetUserTradingState(userId, balance);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset paper account.';
      res.status(400).json({ error: message });
    }
  });

  // Server-Validated & Atomic Ledger Paper Order Placement
  app.post('/api/trading/orders', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const body = req.body ?? {};
      const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
      const side = body.side === 'BUY' || body.side === 'SELL' ? body.side : null;
      const type = body.type === 'MARKET' || body.type === 'LIMIT' ? body.type : null;
      const quantity = Number(body.quantity);
      const limitPrice = body.limitPrice !== undefined ? Number(body.limitPrice) : undefined;
      const stopLoss = body.stopLoss !== undefined ? Number(body.stopLoss) : undefined;
      const takeProfit = body.takeProfit !== undefined ? Number(body.takeProfit) : undefined;
      const idempotencyKey =
        typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : undefined;

      if (!symbol || !side || !type || !Number.isFinite(quantity)) {
        res.status(400).json({
          accepted: false,
          errors: ['Valid symbol, side (BUY/SELL), type (MARKET/LIMIT), and numeric quantity are required.'],
        });
        return;
      }

      const orderReq: OrderRequest = {
        symbol,
        side,
        type,
        quantity,
        limitPrice,
        stopLoss,
        takeProfit,
        strategyId: typeof body.strategyId === 'string' ? body.strategyId : 'MANUAL',
      };

      const outcome = store.executePaperOrder(userId, orderReq, idempotencyKey);
      if (!outcome.accepted) {
        res.status(400).json(outcome);
        return;
      }
      res.status(201).json(outcome);
    } catch (err) {
      safeErrorLog('trading.placeOrder', err);
      if (err instanceof DuplicateTransactionError) {
        res.status(409).json({ accepted: false, errors: [err.message] });
        return;
      }
      if (err instanceof PermissionDeniedError) {
        res.status(403).json({ accepted: false, errors: [err.message] });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unable to process paper order.';
      res.status(400).json({ accepted: false, errors: [message] });
    }
  });

  // Server-Validated & Atomic Order Cancellation
  app.post('/api/trading/orders/:orderId/cancel', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const orderId = String(req.params.orderId ?? '');
      const result = store.cancelPaperOrder(userId, orderId);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to cancel order.';
      if (message === 'Open order not found.') {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  });

  // Persistent Immutable Trading Ledger for Authenticated User
  app.get('/api/trading/ledger', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const limit = Number(req.query.limit) || 150;
    const transactions = store.getUserLedger(userId, limit);
    res.json({
      mode: 'SIMULATED_PAPER_ONLY',
      transactions,
    });
  });

  // Simulated Paper Deposits & Withdrawals (strictly virtual, idempotent, non-negative)
  app.post('/api/trading/transfers', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const body = req.body ?? {};
      const direction =
        body.direction === 'SIMULATED_DEPOSIT' || body.direction === 'SIMULATED_WITHDRAWAL'
          ? body.direction
          : null;
      const amount = Number(body.amount);
      const idempotencyKey =
        typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : undefined;

      if (!direction || !Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({
          error: 'Valid direction (SIMULATED_DEPOSIT | SIMULATED_WITHDRAWAL) and positive amount are required.',
        });
        return;
      }

      const result = store.executeSimulatedTransfer(userId, {
        direction,
        amount,
        note: typeof body.note === 'string' ? body.note : undefined,
        idempotencyKey,
      });
      res.status(201).json({
        ...result,
        mode: 'SIMULATED_PAPER_ONLY',
      });
    } catch (err) {
      safeErrorLog('trading.transfer', err);
      if (err instanceof DuplicateTransactionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PermissionDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unable to execute simulated transfer.';
      res.status(400).json({ error: message });
    }
  });

  // ---- Phase 5: User Wallets, Simulated Deposits, Withdrawals & Payment Infrastructure ----
  app.get('/api/wallet/providers', (_req, res) => {
    res.json({
      mode: 'SIMULATED_PAPER_ONLY',
      liveProcessingEnabled: false,
      providers: paymentRegistry.listPublicProviders(),
    });
  });

  app.get('/api/wallet', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const wallet = store.getUserWalletSummary(userId);
      res.json({
        mode: 'SIMULATED_PAPER_ONLY',
        liveProcessingEnabled: false,
        wallet,
        providers: paymentRegistry.listPublicProviders(),
      });
    } catch (err) {
      safeErrorLog('wallet.summary', err);
      const message = err instanceof Error ? err.message : 'Unable to load wallet summary.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/wallet/transactions', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const limit = Number(req.query.limit) || 120;
    res.json({
      mode: 'SIMULATED_PAPER_ONLY',
      transactions: store.getUserWalletTransactions(userId, limit),
    });
  });

  app.post('/api/wallet/deposits', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const body = req.body ?? {};
      const asset = typeof body.asset === 'string' ? body.asset : '';
      const amount = Number(body.amount);
      const providerId = typeof body.providerId === 'string' ? body.providerId : 'sim_sandbox_rail';
      const note = typeof body.note === 'string' ? body.note : undefined;
      const requestManualReview = Boolean(body.requestManualReview);
      const idempotencyKey =
        typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : undefined;

      if (!asset || !Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'Valid asset and positive deposit amount are required.' });
        return;
      }

      const result = store.createSimulatedDeposit(userId, {
        asset,
        amount,
        providerId,
        note,
        idempotencyKey,
        requestManualReview,
      });

      res.status(201).json({
        mode: 'SIMULATED_PAPER_ONLY',
        liveProcessingEnabled: false,
        ...result,
      });
    } catch (err) {
      safeErrorLog('wallet.deposit', err);
      if (err instanceof DuplicateTransactionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PermissionDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unable to record simulated deposit.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/wallet/withdrawals', (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    try {
      const body = req.body ?? {};
      const asset = typeof body.asset === 'string' ? body.asset : '';
      const amount = Number(body.amount);
      const destination = typeof body.destination === 'string' ? body.destination : '';
      const providerId = typeof body.providerId === 'string' ? body.providerId : 'sim_sandbox_rail';
      const confirmed = body.confirmed === true;
      const note = typeof body.note === 'string' ? body.note : undefined;
      const requestManualReview = Boolean(body.requestManualReview);
      const idempotencyKey =
        typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : undefined;

      if (!asset || !Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'Valid asset and positive withdrawal amount are required.' });
        return;
      }

      const result = store.createSimulatedWithdrawal(userId, {
        asset,
        amount,
        destination,
        providerId,
        confirmed,
        note,
        idempotencyKey,
        requestManualReview,
      });

      res.status(201).json({
        mode: 'SIMULATED_PAPER_ONLY',
        liveProcessingEnabled: false,
        ...result,
      });
    } catch (err) {
      safeErrorLog('wallet.withdrawal', err);
      if (err instanceof DuplicateTransactionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PermissionDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unable to submit simulated withdrawal.';
      res.status(400).json({ error: message });
    }
  });

  // ---- Administration Routes (RBAC: ADMIN only) ----
  app.get('/api/admin/overview', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    res.json({
      overview: store.getAdminOverview(),
      pairs: store.listTradingPairs(),
    });
  });

  app.get('/api/admin/users', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    res.json({ users: store.listAdminUsers() });
  });

  app.patch('/api/admin/users/:userId', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
      const targetId = String(req.params.userId ?? '');
      const { status, role, emailVerified } = req.body ?? {};
      const validStatus: AccountStatus | undefined =
        status === 'ACTIVE' || status === 'SUSPENDED' ? status : undefined;
      const validRole: UserRole | undefined =
        role === 'TRADER' || role === 'ADMIN' ? role : undefined;

      const updated = store.adminUpdateUser(admin.id, targetId, {
        status: validStatus,
        role: validRole,
        emailVerified: typeof emailVerified === 'boolean' ? emailVerified : undefined,
      });
      res.json({ user: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update user.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/admin/orders', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const limit = Number(req.query.limit) || 120;
    res.json({ orders: store.listAdminOrders(limit) });
  });

  app.get('/api/admin/transactions', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const limit = Number(req.query.limit) || 150;
    res.json({ transactions: store.listAdminTransactions(limit) });
  });

  app.get('/api/admin/pairs', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    res.json({ pairs: store.listTradingPairs() });
  });

  app.patch('/api/admin/pairs/:symbol', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
      const symbol = String(req.params.symbol ?? '').trim().toUpperCase();
      const { enabled, makerFeeRate, takerFeeRate } = req.body ?? {};
      const pair = store.updateTradingPair(admin.id, symbol, {
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        makerFeeRate: typeof makerFeeRate === 'number' ? makerFeeRate : undefined,
        takerFeeRate: typeof takerFeeRate === 'number' ? takerFeeRate : undefined,
      });
      res.json({ pair });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update trading pair.';
      res.status(400).json({ error: message });
    }
  });

  app.patch('/api/admin/settings', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
      const {
        allowNewRegistrations,
        tradingEnabled,
        maxSimulatedDeposit,
        maxSimulatedWithdrawal,
        dailySimulatedWithdrawalLimit,
        withdrawalApprovalThreshold,
        requireAdminApprovalForTransfers,
        maintenanceNotice,
      } = req.body ?? {};
      const settings = store.updatePlatformSettings(admin.id, {
        allowNewRegistrations:
          typeof allowNewRegistrations === 'boolean' ? allowNewRegistrations : undefined,
        tradingEnabled: typeof tradingEnabled === 'boolean' ? tradingEnabled : undefined,
        maxSimulatedDeposit:
          typeof maxSimulatedDeposit === 'number' ? maxSimulatedDeposit : undefined,
        maxSimulatedWithdrawal:
          typeof maxSimulatedWithdrawal === 'number' ? maxSimulatedWithdrawal : undefined,
        dailySimulatedWithdrawalLimit:
          typeof dailySimulatedWithdrawalLimit === 'number'
            ? dailySimulatedWithdrawalLimit
            : undefined,
        withdrawalApprovalThreshold:
          typeof withdrawalApprovalThreshold === 'number' ? withdrawalApprovalThreshold : undefined,
        requireAdminApprovalForTransfers:
          typeof requireAdminApprovalForTransfers === 'boolean'
            ? requireAdminApprovalForTransfers
            : undefined,
        maintenanceNotice: typeof maintenanceNotice === 'string' ? maintenanceNotice : undefined,
      });
      res.json({ settings });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update settings.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/admin/audit-logs', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const limit = Number(req.query.limit) || 120;
    res.json({ logs: store.listAdminAuditLogs(limit) });
  });

  // Admin Phase 5 Wallet & Suspicious Activity Controls (RBAC: ADMIN only)
  app.get('/api/admin/wallet/transactions', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Number(req.query.limit) || 150;
    res.json({ transactions: store.adminListWalletTransactions(statusFilter, limit) });
  });

  app.post('/api/admin/wallet/transactions/:txId/review', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
      const txId = String(req.params.txId ?? '');
      const rawDecision = String(req.body?.decision ?? '').trim().toUpperCase();
      if (!['APPROVE', 'COMPLETE', 'REJECT'].includes(rawDecision)) {
        res.status(400).json({ error: 'Decision must be APPROVE, COMPLETE, or REJECT.' });
        return;
      }
      const transaction = store.adminReviewWalletTransaction(admin.id, txId, {
        decision: rawDecision as 'APPROVE' | 'COMPLETE' | 'REJECT',
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      });
      res.json({ transaction });
    } catch (err) {
      safeErrorLog('admin.walletReview', err);
      if (err instanceof PermissionDeniedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unable to review wallet transaction.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/admin/wallet/alerts', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const limit = Number(req.query.limit) || 120;
    res.json({ alerts: store.adminListSuspiciousAlerts(limit) });
  });

  app.post('/api/admin/wallet/alerts/:alertId/resolve', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
      const alertId = String(req.params.alertId ?? '');
      const alert = store.adminResolveSuspiciousAlert(admin.id, alertId);
      res.json({ alert });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to resolve alert.';
      res.status(400).json({ error: message });
    }
  });

  // Read-only Public Spot & 24h Stats Proxy (Binance Vision primary + Coinbase Exchange fallback)
  app.get('/api/markets/live-quotes', async (req, res) => {
    try {
      const requested =
        typeof req.query.symbols === 'string' && req.query.symbols.trim()
          ? req.query.symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
          : [...SUPPORTED_CRYPTO_SYMBOLS];

      const validSymbols = requested.filter((s) =>
        (SUPPORTED_CRYPTO_SYMBOLS as readonly string[]).includes(s)
      );
      if (validSymbols.length === 0) {
        res.status(400).json({
          status: 'UNAVAILABLE',
          quotes: {},
          error: `Unsupported symbols requested. Supported pairs: ${SUPPORTED_CRYPTO_SYMBOLS.join(', ')}`,
        });
        return;
      }

      const payload = await marketFeed.getLiveQuotes(validSymbols);
      if (payload.status === 'UNAVAILABLE' || Object.keys(payload.quotes).length === 0) {
        res.status(503).json(payload);
        return;
      }
      res.json({
        ...payload,
        count: Object.keys(payload.quotes).length,
      });
    } catch (err) {
      safeErrorLog('markets.liveQuotes', err);
      res.status(503).json({
        status: 'UNAVAILABLE',
        quotes: {},
        error: 'Unable to retrieve live market quotes from upstream providers.',
      });
    }
  });

  // Read-only Historical OHLCV Candles Proxy (multiple timeframes)
  app.get('/api/markets/candles', async (req, res) => {
    try {
      const symbol =
        typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : 'BTCUSDT';
      const timeframe =
        typeof req.query.timeframe === 'string' ? (req.query.timeframe.trim() as Timeframe) : '1h';
      const limit = Number(req.query.limit) || 120;

      if (!(SUPPORTED_CRYPTO_SYMBOLS as readonly string[]).includes(symbol)) {
        res.status(400).json({
          ok: false,
          candles: [],
          dataSource: 'UNAVAILABLE',
          error: `Unsupported market symbol "${symbol}".`,
        });
        return;
      }

      if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
        res.status(400).json({
          ok: false,
          candles: [],
          dataSource: 'UNAVAILABLE',
          error: `Unsupported timeframe "${timeframe}". Allowed: ${SUPPORTED_TIMEFRAMES.join(', ')}`,
        });
        return;
      }

      const payload = await marketFeed.getHistoricalCandles(symbol, timeframe, limit);
      if (!payload.ok || payload.candles.length === 0) {
        res.status(503).json(payload);
        return;
      }
      res.json(payload);
    } catch (err) {
      safeErrorLog('markets.candles', err);
      res.status(503).json({
        ok: false,
        candles: [],
        dataSource: 'UNAVAILABLE',
        error: 'Unable to fetch historical market candles from upstream providers.',
      });
    }
  });

  // Hard Guard blocking any live real-money payment processing attempt
  app.all('/api/payments/:provider/charge', (req, res) => {
    res.status(403).json({
      accepted: false,
      provider: req.params.provider,
      ...paymentRegistry.assertLivePaymentsBlocked(),
    });
  });

  // Phase 7 Hard Guard on future live exchange order endpoints
  app.all('/api/exchange/:exchange/orders', (req, res) => {
    res.status(403).json({
      accepted: false,
      mode: 'SIMULATED_PAPER_ONLY',
      exchange: req.params.exchange,
      reason:
        'Live exchange routing is locked. Server environment API credentials and explicit live-mode authorization are not enabled.',
    });
  });

  return app;
}

async function startServer() {
  const app = createApp(defaultStore);
  const port = Number(process.env.PORT) || 3000;
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`77 TRADE IT server listening on http://0.0.0.0:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startServer();
}
