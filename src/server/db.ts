import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { INITIAL_MARKET_SPECS } from '../engine/marketData.ts';
import { computePerformanceMetrics } from '../engine/risk.ts';
import { cancelOrder, createInitialEngineState, placeOrder } from '../engine/tradingEngine.ts';
import type { OrderRecord, OrderRequest, TradingEngineState } from '../engine/types.ts';
import {
  isSupportedWalletAsset,
  paymentRegistry,
  SUPPORTED_WALLET_ASSETS,
  type PaymentRailType,
  type SimulatedDepositInstruction,
  type WalletAsset,
} from './paymentInfrastructure.ts';

export type UserRole = 'TRADER' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export interface StoredUserRecord {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: UserRole;
  status: AccountStatus;
  baseCurrency: 'USD' | 'EUR' | 'GBP';
  emailVerified: boolean;
  passwordHash: string;
  passwordSalt: string;
  createdAt: number;
  updatedAt: number;
}

export interface PublicUserProfile {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: UserRole;
  status: AccountStatus;
  baseCurrency: 'USD' | 'EUR' | 'GBP';
  emailVerified: boolean;
  bio: string;
  timezone: string;
  riskTier: string;
  createdAt: number;
  updatedAt: number;
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

export interface SimulatedTransferRecord {
  id: string;
  userId: string;
  direction: 'SIMULATED_DEPOSIT' | 'SIMULATED_WITHDRAWAL';
  asset: string;
  amount: number;
  status: 'COMPLETED';
  note: string;
  idempotencyKey: string;
  createdAt: number;
}

export type WalletTransactionStatus = 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

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

export interface AdminAuditLogRecord {
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

export class DuplicateTransactionError extends Error {
  constructor(message = 'Duplicate transaction rejected by idempotency guard.') {
    super(message);
    this.name = 'DuplicateTransactionError';
  }
}

export class PermissionDeniedError extends Error {
  constructor(message = 'Forbidden: insufficient permissions.') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');

export function sanitizeText(input: string, maxLen = 120): string {
  return input
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

function hashTokenSha256(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class PersistentStore {
  private readonly dbPath: string;
  private readonly legacyJsonPath: string;
  private readonly secretPath: string;
  private readonly db: DatabaseSync;
  private cachedSecret: string | null = null;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, 'tradeit.sqlite');
    this.legacyJsonPath = path.join(dataDir, 'tradeit-db.json');
    this.secretPath = path.join(dataDir, '.session-secret');

    this.db = new DatabaseSync(this.dbPath, {
      enableForeignKeyConstraints: true,
      timeout: 5000,
    });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
    this.seedDefaults();
    this.migrateLegacyJsonIfNeeded();
    this.backfillUserWallets();
    this.bootstrapAdminFromEnv();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        handle TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'TRADER' CHECK(role IN ('TRADER', 'ADMIN')),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED')),
        base_currency TEXT NOT NULL DEFAULT 'USD' CHECK(base_currency IN ('USD', 'EUR', 'GBP')),
        email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        bio TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        risk_tier TEXT NOT NULL DEFAULT 'STANDARD',
        preferences_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        user_agent TEXT,
        ip_address TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS auth_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK(purpose IN ('EMAIL_VERIFY', 'PASSWORD_RESET')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

      CREATE TABLE IF NOT EXISTS balances (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        starting_balance REAL NOT NULL CHECK(starting_balance > 0),
        available_cash REAL NOT NULL CHECK(available_cash >= 0),
        reserved_cash REAL NOT NULL DEFAULT 0 CHECK(reserved_cash >= 0),
        currency TEXT NOT NULL DEFAULT 'USDT',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('LONG', 'SHORT')),
        quantity REAL NOT NULL CHECK(quantity > 0),
        entry_price REAL NOT NULL CHECK(entry_price > 0),
        cost_basis REAL NOT NULL CHECK(cost_basis >= 0),
        stop_loss REAL,
        take_profit REAL,
        strategy_id TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id);

      CREATE TABLE IF NOT EXISTS trading_pairs (
        symbol TEXT PRIMARY KEY,
        base_asset TEXT NOT NULL,
        quote_asset TEXT NOT NULL,
        name TEXT NOT NULL,
        tick_size REAL NOT NULL,
        min_qty REAL NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        maker_fee_rate REAL NOT NULL DEFAULT 0.001,
        taker_fee_rate REAL NOT NULL DEFAULT 0.001,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
        order_type TEXT NOT NULL CHECK(order_type IN ('MARKET', 'LIMIT')),
        quantity REAL NOT NULL,
        requested_price REAL NOT NULL,
        executed_price REAL,
        fee REAL NOT NULL DEFAULT 0,
        reserved_cash REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('OPEN', 'FILLED', 'CANCELLED', 'REJECTED')),
        strategy_id TEXT NOT NULL,
        reject_reason TEXT,
        client_order_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, client_order_id)
      );
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS completed_trades (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('LONG', 'SHORT')),
        quantity REAL NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        gross_pnl REAL NOT NULL,
        fees_paid REAL NOT NULL,
        net_pnl REAL NOT NULL,
        return_pct REAL NOT NULL,
        close_reason TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_completed_trades_user ON completed_trades(user_id, closed_at DESC);

      CREATE TABLE IF NOT EXISTS simulated_transfers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK(direction IN ('SIMULATED_DEPOSIT', 'SIMULATED_WITHDRAWAL')),
        asset TEXT NOT NULL DEFAULT 'USDT',
        amount REAL NOT NULL CHECK(amount > 0),
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        note TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transfers_user ON simulated_transfers(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ledger_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        asset TEXT NOT NULL,
        amount REAL NOT NULL,
        balance_before REAL NOT NULL,
        balance_after REAL NOT NULL CHECK(balance_after >= 0),
        tx_type TEXT NOT NULL CHECK(tx_type IN (
          'VIRTUAL_DEPOSIT',
          'SIMULATED_WITHDRAWAL',
          'WALLET_WITHDRAWAL_RESERVE',
          'WALLET_WITHDRAWAL_RELEASE',
          'VIRTUAL_RESET',
          'ORDER_FILL',
          'ORDER_RESERVE',
          'ORDER_CANCEL_RELEASE',
          'POSITION_SETTLEMENT'
        )),
        reference_id TEXT,
        idempotency_key TEXT UNIQUE,
        description TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'SIMULATED_PAPER' CHECK(mode IN ('SIMULATED_PAPER')),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_transactions(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_wallets (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        wallet_uid TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'FROZEN')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallet_asset_balances (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        asset TEXT NOT NULL CHECK(asset IN ('USDT', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'AVAX', 'LINK', 'ADA')),
        available_balance REAL NOT NULL DEFAULT 0 CHECK(available_balance >= 0),
        reserved_balance REAL NOT NULL DEFAULT 0 CHECK(reserved_balance >= 0),
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, asset)
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_bal_user ON wallet_asset_balances(user_id);

      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wallet_uid TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('DEPOSIT', 'WITHDRAWAL')),
        asset TEXT NOT NULL CHECK(asset IN ('USDT', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'AVAX', 'LINK', 'ADA')),
        amount REAL NOT NULL CHECK(amount > 0),
        usd_equivalent REAL NOT NULL CHECK(usd_equivalent >= 0),
        fee REAL NOT NULL DEFAULT 0 CHECK(fee >= 0),
        net_amount REAL NOT NULL CHECK(net_amount > 0),
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        payment_rail TEXT NOT NULL CHECK(payment_rail IN ('SIMULATED_INTERNAL', 'BANK_TRANSFER_SEPA_ACH', 'CARD_GATEWAY')),
        destination_or_source TEXT NOT NULL,
        reference_code TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED')),
        note TEXT NOT NULL DEFAULT '',
        rejection_reason TEXT,
        instruction_json TEXT,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        mode TEXT NOT NULL DEFAULT 'SIMULATED_PAPER' CHECK(mode IN ('SIMULATED_PAPER')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_status ON wallet_transactions(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS suspicious_activity_alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        transaction_id TEXT,
        severity TEXT NOT NULL CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH')),
        rule_code TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'RESOLVED')),
        resolved_by TEXT,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_status ON suspicious_activity_alerts(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_by TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        actor_email TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        ip_address TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);

      CREATE TABLE IF NOT EXISTS user_engine_snapshots (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Idempotently migrate existing ledger_transactions table if older CHECK constraint lacks wallet reserve/release types
    const ledgerSchemaRow = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ledger_transactions'`)
      .get() as { sql: string } | undefined;
    if (ledgerSchemaRow?.sql && !ledgerSchemaRow.sql.includes('WALLET_WITHDRAWAL_RESERVE')) {
      this.db.exec('PRAGMA foreign_keys = OFF;');
      this.runInTransaction(() => {
        this.db.exec(`
          CREATE TABLE ledger_transactions_v2 (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            asset TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_before REAL NOT NULL,
            balance_after REAL NOT NULL CHECK(balance_after >= 0),
            tx_type TEXT NOT NULL CHECK(tx_type IN (
              'VIRTUAL_DEPOSIT',
              'SIMULATED_WITHDRAWAL',
              'WALLET_WITHDRAWAL_RESERVE',
              'WALLET_WITHDRAWAL_RELEASE',
              'VIRTUAL_RESET',
              'ORDER_FILL',
              'ORDER_RESERVE',
              'ORDER_CANCEL_RELEASE',
              'POSITION_SETTLEMENT'
            )),
            reference_id TEXT,
            idempotency_key TEXT UNIQUE,
            description TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'SIMULATED_PAPER' CHECK(mode IN ('SIMULATED_PAPER')),
            created_at INTEGER NOT NULL
          );
          INSERT INTO ledger_transactions_v2 SELECT * FROM ledger_transactions;
          DROP TABLE ledger_transactions;
          ALTER TABLE ledger_transactions_v2 RENAME TO ledger_transactions;
          CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_transactions(user_id, created_at DESC);
        `);
      });
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  private seedDefaults(): void {
    const now = Date.now();
    const upsertPair = this.db.prepare(`
      INSERT OR IGNORE INTO trading_pairs
        (symbol, base_asset, quote_asset, name, tick_size, min_qty, enabled, maker_fee_rate, taker_fee_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0.001, 0.001, ?)
    `);
    for (const m of INITIAL_MARKET_SPECS) {
      upsertPair.run(m.symbol, m.baseAsset, m.quoteAsset, m.name, m.tickSize, m.minQty, now);
    }

    const defaultSettings: PlatformSettingsRecord = {
      allowNewRegistrations: true,
      tradingEnabled: true,
      maxSimulatedDeposit: 250_000,
      maxSimulatedWithdrawal: 100_000,
      dailySimulatedWithdrawalLimit: 250_000,
      withdrawalApprovalThreshold: 10_000,
      requireAdminApprovalForTransfers: false,
      maintenanceNotice: '',
      updatedBy: 'SYSTEM',
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT OR IGNORE INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run('platform_config', JSON.stringify(defaultSettings), 'SYSTEM', now);
  }

  private migrateLegacyJsonIfNeeded(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
    if (countRow.cnt > 0 || !fs.existsSync(this.legacyJsonPath)) return;

    try {
      const raw = fs.readFileSync(this.legacyJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        users?: Array<{
          id: string;
          email: string;
          displayName: string;
          handle: string;
          role?: UserRole;
          baseCurrency?: 'USD' | 'EUR' | 'GBP';
          passwordHash: string;
          passwordSalt: string;
          createdAt: number;
          updatedAt: number;
        }>;
        tradingStates?: Record<string, { state: TradingEngineState; updatedAt: number }>;
      };
      if (!Array.isArray(parsed.users) || parsed.users.length === 0) return;

      this.runInTransaction(() => {
        for (const u of parsed.users!) {
          this.db
            .prepare(`
              INSERT OR IGNORE INTO users
                (id, email, display_name, handle, role, status, base_currency, email_verified, password_hash, password_salt, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 1, ?, ?, ?, ?)
            `)
            .run(
              u.id,
              u.email.toLowerCase(),
              u.displayName,
              u.handle.toLowerCase(),
              u.role === 'ADMIN' ? 'ADMIN' : 'TRADER',
              u.baseCurrency ?? 'USD',
              u.passwordHash,
              u.passwordSalt,
              u.createdAt,
              u.updatedAt
            );

          this.db
            .prepare(
              `INSERT OR IGNORE INTO profiles (user_id, bio, timezone, risk_tier, preferences_json, updated_at) VALUES (?, '', 'UTC', 'STANDARD', '{}', ?)`
            )
            .run(u.id, u.updatedAt);

          const snap = parsed.tradingStates?.[u.id];
          if (snap?.state) {
            this.persistEngineStateSync(u.id, snap.state, snap.updatedAt);
          }
        }
      });
    } catch {
      // Ignore corrupt legacy file safely
    }
  }

  private bootstrapAdminFromEnv(): void {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!email || !password || password.length < 8) return;

    const existing = this.db.prepare('SELECT id, role FROM users WHERE email = ?').get(email) as
      | { id: string; role: string }
      | undefined;
    if (existing) {
      if (existing.role !== 'ADMIN') {
        this.db
          .prepare(`UPDATE users SET role = 'ADMIN', email_verified = 1, updated_at = ? WHERE id = ?`)
          .run(Date.now(), existing.id);
      }
      return;
    }

    this.createUserInternal({
      email,
      password,
      displayName: 'Platform Administrator',
      handle: 'admin_desk',
      role: 'ADMIN',
      emailVerified: true,
      startingBalance: 100_000,
    });
  }

  private runInTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignore rollback errors if connection already rolled back
      }
      throw err;
    }
  }

  private getSessionSecret(): string {
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
      return process.env.SESSION_SECRET;
    }
    if (this.cachedSecret) return this.cachedSecret;
    if (fs.existsSync(this.secretPath)) {
      const existing = fs.readFileSync(this.secretPath, 'utf8').trim();
      if (existing.length >= 32) {
        this.cachedSecret = existing;
        return existing;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(this.secretPath, generated, { mode: 0o600 });
    this.cachedSecret = generated;
    return generated;
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  private verifyPassword(password: string, salt: string, expectedHash: string): boolean {
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  }

  private mapPublicProfile(row: Record<string, unknown>): PublicUserProfile {
    return {
      id: String(row.id),
      email: String(row.email),
      displayName: String(row.display_name),
      handle: String(row.handle),
      role: row.role === 'ADMIN' ? 'ADMIN' : 'TRADER',
      status: row.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      baseCurrency: (row.base_currency as 'USD' | 'EUR' | 'GBP') ?? 'USD',
      emailVerified: Number(row.email_verified) === 1,
      bio: typeof row.bio === 'string' ? row.bio : '',
      timezone: typeof row.timezone === 'string' ? row.timezone : 'UTC',
      riskTier: typeof row.risk_tier === 'string' ? row.risk_tier : 'STANDARD',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  createSessionToken(
    userId: string,
    ttlMs = 1000 * 60 * 60 * 24 * 7,
    meta?: { userAgent?: string; ipAddress?: string }
  ): string {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        exp: expiresAt,
        nonce: crypto.randomBytes(8).toString('hex'),
      })
    ).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(payload)
      .digest('base64url');
    const token = `${payload}.${sig}`;
    const tokenHash = hashTokenSha256(token);

    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, user_agent, ip_address, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        `ses-${crypto.randomUUID()}`,
        userId,
        tokenHash,
        expiresAt,
        meta?.userAgent ? sanitizeText(meta.userAgent, 180) : null,
        meta?.ipAddress ? sanitizeText(meta.ipAddress, 64) : null,
        now
      );

    return token;
  }

  verifySessionToken(token: string): string | null {
    if (!token || !token.includes('.')) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.getSessionSecret())
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        sub?: string;
        exp?: number;
      };
      if (!parsed.sub || !parsed.exp || Date.now() > parsed.exp) return null;

      const tokenHash = hashTokenSha256(token);
      const row = this.db
        .prepare(`
          SELECT s.user_id, s.expires_at, s.revoked_at, u.status
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?
        `)
        .get(tokenHash) as
        | { user_id: string; expires_at: number; revoked_at: number | null; status: string }
        | undefined;

      if (!row) return null;
      if (row.revoked_at !== null) return null;
      if (Date.now() > row.expires_at) return null;
      if (row.status !== 'ACTIVE') return null;

      return row.user_id;
    } catch {
      return null;
    }
  }

  revokeSessionToken(token: string): void {
    if (!token) return;
    const tokenHash = hashTokenSha256(token);
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(Date.now(), tokenHash);
  }

  revokeAllUserSessions(userId: string): void {
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(Date.now(), userId);
  }

  private createUserInternal(input: {
    email: string;
    password: string;
    displayName: string;
    handle?: string;
    role?: UserRole;
    emailVerified?: boolean;
    startingBalance?: number;
  }): { user: PublicUserProfile; token: string; tradingState: TradingEngineState } {
    const email = sanitizeText(input.email, 120).toLowerCase();
    const displayName = sanitizeText(input.displayName, 48);
    const password = input.password;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please enter a valid email address.');
    }
    if (displayName.length < 2 || displayName.length > 48) {
      throw new Error('Display name must be between 2 and 48 characters.');
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    const baseHandle =
      (input.handle?.trim() || email.split('@')[0] || 'trader')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 24) || 'trader';

    const startingBalance =
      input.startingBalance && Number.isFinite(input.startingBalance) && input.startingBalance >= 1000
        ? Math.min(10_000_000, input.startingBalance)
        : 100_000;

    return this.runInTransaction(() => {
      const existingEmail = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existingEmail) {
        throw new Error('An account with this email is already registered.');
      }

      let candidateHandle = baseHandle;
      let suffix = 1;
      while (this.db.prepare('SELECT id FROM users WHERE handle = ?').get(candidateHandle)) {
        suffix += 1;
        candidateHandle = `${baseHandle.slice(0, 20)}${suffix}`;
      }

      const now = Date.now();
      const id = `usr-${crypto.randomUUID()}`;
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = this.hashPassword(password, salt);
      const role: UserRole = input.role === 'ADMIN' ? 'ADMIN' : 'TRADER';
      const emailVerified = input.emailVerified ? 1 : 0;

      this.db
        .prepare(`
          INSERT INTO users
            (id, email, display_name, handle, role, status, base_currency, email_verified, password_hash, password_salt, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'USD', ?, ?, ?, ?, ?)
        `)
        .run(id, email, displayName, candidateHandle, role, emailVerified, passwordHash, salt, now, now);

      this.db
        .prepare(
          `INSERT INTO profiles (user_id, bio, timezone, risk_tier, preferences_json, updated_at) VALUES (?, '', 'UTC', 'STANDARD', '{}', ?)`
        )
        .run(id, now);

      const tradingState = createInitialEngineState({ startingBalance, seedDemoPositions: false });
      this.persistEngineStateSync(id, tradingState, now);
      this.ensureUserWalletSync(id, tradingState.availableCash, now);

      // Record initial virtual capital allocation in immutable ledger
      this.insertLedgerEntrySync({
        userId: id,
        asset: 'USDT',
        amount: Number(startingBalance.toFixed(2)),
        balanceBefore: 0,
        balanceAfter: Number(startingBalance.toFixed(2)),
        txType: 'VIRTUAL_DEPOSIT',
        referenceId: id,
        idempotencyKey: `init-dep-${id}`,
        description: 'Initial simulated paper trading capital allocation',
        createdAt: now,
      });

      this.insertAuditLogSync({
        actorUserId: id,
        actorEmail: email,
        action: role === 'ADMIN' ? 'ADMIN_ACCOUNT_BOOTSTRAPPED' : 'USER_REGISTERED',
        targetType: 'USER',
        targetId: id,
        details: { role, startingBalance },
        ipAddress: null,
        createdAt: now,
      });

      const user = this.getPublicUserById(id)!;
      const token = this.createSessionToken(id);
      return { user, token, tradingState };
    });
  }

  async registerUser(input: {
    email: string;
    password: string;
    displayName: string;
    handle?: string;
    startingBalance?: number;
  }): Promise<{
    user: PublicUserProfile;
    token: string;
    tradingState: TradingEngineState;
    verificationToken?: string;
  }> {
    const settings = this.getPlatformSettings();
    if (!settings.allowNewRegistrations) {
      throw new Error('New account registrations are currently paused by the platform administrator.');
    }
    const created = this.createUserInternal({
      ...input,
      role: 'TRADER',
      emailVerified: false,
    });
    const verificationToken = this.issueAuthToken(created.user.id, 'EMAIL_VERIFY');
    return {
      ...created,
      verificationToken: process.env.SMTP_HOST ? undefined : verificationToken,
    };
  }

  authenticateUser(
    input: { email: string; password: string },
    meta?: { userAgent?: string; ipAddress?: string }
  ): { user: PublicUserProfile; token: string; tradingState: TradingEngineState } {
    const email = input.email.trim().toLowerCase();
    const row = this.db
      .prepare(`
        SELECT u.*, p.bio, p.timezone, p.risk_tier
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.email = ?
      `)
      .get(email) as Record<string, unknown> | undefined;

    if (!row || !this.verifyPassword(input.password, String(row.password_salt), String(row.password_hash))) {
      throw new Error('Invalid email or password.');
    }

    if (row.status === 'SUSPENDED') {
      throw new PermissionDeniedError('This account has been suspended by an administrator.');
    }

    const userId = String(row.id);
    const existingState =
      this.getUserTradingState(userId)?.state ??
      createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
    const token = this.createSessionToken(userId, undefined, meta);

    this.insertAuditLogSync({
      actorUserId: userId,
      actorEmail: email,
      action: 'USER_LOGIN',
      targetType: 'SESSION',
      targetId: userId,
      details: { role: row.role },
      ipAddress: meta?.ipAddress ?? null,
      createdAt: Date.now(),
    });

    return {
      user: this.mapPublicProfile(row),
      token,
      tradingState: existingState,
    };
  }

  getPublicUserById(userId: string): PublicUserProfile | null {
    const row = this.db
      .prepare(`
        SELECT u.*, p.bio, p.timezone, p.risk_tier
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.id = ?
      `)
      .get(userId) as Record<string, unknown> | undefined;
    return row ? this.mapPublicProfile(row) : null;
  }

  issueAuthToken(userId: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMs = 1000 * 60 * 30): string {
    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashTokenSha256(rawToken);
    const now = Date.now();
    this.db
      .prepare(`
        INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, used_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `)
      .run(`tok-${crypto.randomUUID()}`, userId, purpose, tokenHash, now + ttlMs, now);
    return rawToken;
  }

  requestEmailVerification(userId: string): { sent: true; previewToken?: string } {
    const user = this.getPublicUserById(userId);
    if (!user) throw new Error('User account not found.');
    if (user.emailVerified) {
      return { sent: true };
    }
    const rawToken = this.issueAuthToken(userId, 'EMAIL_VERIFY');
    this.insertAuditLogSync({
      actorUserId: userId,
      actorEmail: user.email,
      action: 'EMAIL_VERIFICATION_REQUESTED',
      targetType: 'USER',
      targetId: userId,
      details: { smtpConfigured: Boolean(process.env.SMTP_HOST) },
      ipAddress: null,
      createdAt: Date.now(),
    });
    return {
      sent: true,
      previewToken: process.env.SMTP_HOST ? undefined : rawToken,
    };
  }

  verifyEmailWithToken(rawToken: string): PublicUserProfile {
    const tokenHash = hashTokenSha256(rawToken.trim());
    const now = Date.now();
    return this.runInTransaction(() => {
      const tok = this.db
        .prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = 'EMAIL_VERIFY'`)
        .get(tokenHash) as Record<string, unknown> | undefined;

      if (!tok || tok.used_at !== null || now > Number(tok.expires_at)) {
        throw new Error('Invalid or expired verification token.');
      }

      const userId = String(tok.user_id);
      this.db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(now, String(tok.id));
      this.db
        .prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?')
        .run(now, userId);

      const user = this.getPublicUserById(userId);
      if (!user) throw new Error('User account not found.');

      this.insertAuditLogSync({
        actorUserId: userId,
        actorEmail: user.email,
        action: 'EMAIL_VERIFIED',
        targetType: 'USER',
        targetId: userId,
        details: {},
        ipAddress: null,
        createdAt: now,
      });
      return user;
    });
  }

  requestPasswordReset(emailInput: string): { accepted: true; previewToken?: string } {
    const email = sanitizeText(emailInput, 120).toLowerCase();
    const row = this.db
      .prepare('SELECT id, email, status FROM users WHERE email = ?')
      .get(email) as { id: string; email: string; status: string } | undefined;

    if (!row || row.status !== 'ACTIVE') {
      return { accepted: true };
    }

    const rawToken = this.issueAuthToken(row.id, 'PASSWORD_RESET', 1000 * 60 * 15);
    this.insertAuditLogSync({
      actorUserId: row.id,
      actorEmail: row.email,
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'USER',
      targetId: row.id,
      details: { smtpConfigured: Boolean(process.env.SMTP_HOST) },
      ipAddress: null,
      createdAt: Date.now(),
    });
    return {
      accepted: true,
      previewToken: process.env.SMTP_HOST ? undefined : rawToken,
    };
  }

  resetPasswordWithToken(rawToken: string, newPassword: string): { reset: true } {
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long.');
    }
    const tokenHash = hashTokenSha256(rawToken.trim());
    const now = Date.now();

    return this.runInTransaction(() => {
      const tok = this.db
        .prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = 'PASSWORD_RESET'`)
        .get(tokenHash) as Record<string, unknown> | undefined;

      if (!tok || tok.used_at !== null || now > Number(tok.expires_at)) {
        throw new Error('Invalid or expired password reset token.');
      }

      const userId = String(tok.user_id);
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = this.hashPassword(newPassword, salt);

      this.db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(now, String(tok.id));
      this.db
        .prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
        .run(hash, salt, now, userId);

      this.revokeAllUserSessions(userId);
      const user = this.getPublicUserById(userId);
      this.insertAuditLogSync({
        actorUserId: userId,
        actorEmail: user?.email ?? userId,
        action: 'PASSWORD_RESET_COMPLETED',
        targetType: 'USER',
        targetId: userId,
        details: { sessionsRevoked: true },
        ipAddress: null,
        createdAt: now,
      });

      return { reset: true as const };
    });
  }

  async updateUserProfile(
    userId: string,
    patch: {
      displayName?: string;
      handle?: string;
      baseCurrency?: 'USD' | 'EUR' | 'GBP';
      bio?: string;
      timezone?: string;
    }
  ): Promise<PublicUserProfile> {
    return this.runInTransaction(() => {
      const existing = this.getPublicUserById(userId);
      if (!existing) {
        throw new Error('User account not found.');
      }

      let nextName = existing.displayName;
      if (patch.displayName !== undefined) {
        const cleaned = sanitizeText(patch.displayName, 48);
        if (cleaned.length < 2 || cleaned.length > 48) {
          throw new Error('Display name must be between 2 and 48 characters.');
        }
        nextName = cleaned;
      }

      let nextHandle = existing.handle;
      if (patch.handle !== undefined) {
        const cleaned = patch.handle
          .trim()
          .toLowerCase()
          .replace(/^@/, '')
          .replace(/[^a-z0-9_]/g, '');
        if (cleaned.length < 2 || cleaned.length > 24) {
          throw new Error('Trader handle must be 2–24 alphanumeric/underscore characters.');
        }
        const clash = this.db
          .prepare('SELECT id FROM users WHERE handle = ? AND id != ?')
          .get(cleaned, userId);
        if (clash) {
          throw new Error('That trader handle is already taken.');
        }
        nextHandle = cleaned;
      }

      const nextCurrency =
        patch.baseCurrency && ['USD', 'EUR', 'GBP'].includes(patch.baseCurrency)
          ? patch.baseCurrency
          : existing.baseCurrency;

      const nextBio = patch.bio !== undefined ? sanitizeText(patch.bio, 180) : existing.bio;
      const nextTimezone =
        patch.timezone !== undefined ? sanitizeText(patch.timezone, 48) || 'UTC' : existing.timezone;
      const now = Date.now();

      this.db
        .prepare(
          `UPDATE users SET display_name = ?, handle = ?, base_currency = ?, updated_at = ? WHERE id = ?`
        )
        .run(nextName, nextHandle, nextCurrency, now, userId);

      this.db
        .prepare(`UPDATE profiles SET bio = ?, timezone = ?, updated_at = ? WHERE user_id = ?`)
        .run(nextBio, nextTimezone, now, userId);

      return this.getPublicUserById(userId)!;
    });
  }

  private validateTradingStatePayload(state: TradingEngineState): void {
    if (
      !state ||
      state.mode !== 'SIMULATED_PAPER' ||
      !state.markets?.BTCUSDT ||
      !Number.isFinite(state.availableCash) ||
      state.availableCash < 0 ||
      !Number.isFinite(state.startingBalance) ||
      state.startingBalance <= 0 ||
      !Array.isArray(state.positions) ||
      !Array.isArray(state.openOrders) ||
      !Array.isArray(state.orderHistory) ||
      !Array.isArray(state.closedTrades)
    ) {
      throw new Error('Invalid trading state payload.');
    }
    for (const pos of state.positions) {
      if (
        !Number.isFinite(pos.quantity) ||
        pos.quantity <= 0 ||
        !Number.isFinite(pos.entryPrice) ||
        pos.entryPrice <= 0
      ) {
        throw new Error('Invalid position record in trading state.');
      }
    }
    for (const ord of state.openOrders) {
      if (
        !Number.isFinite(ord.quantity) ||
        ord.quantity <= 0 ||
        !Number.isFinite(ord.reservedCash) ||
        ord.reservedCash < 0
      ) {
        throw new Error('Invalid open order record in trading state.');
      }
    }
  }

  private insertLedgerEntrySync(input: {
    userId: string;
    asset: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    txType: LedgerTransactionRecord['txType'];
    referenceId: string | null;
    idempotencyKey: string | null;
    description: string;
    createdAt: number;
  }): string | null {
    const id = `tx-${crypto.randomUUID()}`;
    const decimals = input.asset === 'USDT' || input.asset.endsWith('USDT') ? 2 : 8;
    const res = this.db
      .prepare(`
        INSERT OR IGNORE INTO ledger_transactions
          (id, user_id, asset, amount, balance_before, balance_after, tx_type, reference_id, idempotency_key, description, mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SIMULATED_PAPER', ?)
      `)
      .run(
        id,
        input.userId,
        input.asset,
        Number(input.amount.toFixed(decimals)),
        Number(input.balanceBefore.toFixed(decimals)),
        Number(Math.max(0, input.balanceAfter).toFixed(decimals)),
        input.txType,
        input.referenceId,
        input.idempotencyKey,
        sanitizeText(input.description, 220),
        input.createdAt
      );
    return Number(res.changes) > 0 ? id : null;
  }

  private persistEngineStateSync(
    userId: string,
    state: TradingEngineState,
    now: number,
    recordOrderLedger = true
  ): void {
    const metrics = computePerformanceMetrics(state);

    this.db
      .prepare(`
        INSERT INTO balances (user_id, starting_balance, available_cash, reserved_cash, currency, updated_at)
        VALUES (?, ?, ?, ?, 'USDT', ?)
        ON CONFLICT(user_id) DO UPDATE SET
          starting_balance = excluded.starting_balance,
          available_cash = excluded.available_cash,
          reserved_cash = excluded.reserved_cash,
          updated_at = excluded.updated_at
      `)
      .run(
        userId,
        Number(state.startingBalance.toFixed(2)),
        Number(state.availableCash.toFixed(2)),
        Number(metrics.reservedCash.toFixed(2)),
        now
      );

    // Keep USDT wallet available balance synchronized with trading engine cash
    this.ensureUserWalletSync(userId, state.availableCash, now);
    this.db
      .prepare(
        `UPDATE wallet_asset_balances SET available_balance = ?, updated_at = ? WHERE user_id = ? AND asset = 'USDT'`
      )
      .run(Number(Math.max(0, state.availableCash).toFixed(2)), now, userId);

    // Sync open assets/positions
    this.db.prepare('DELETE FROM assets WHERE user_id = ?').run(userId);
    const insertAsset = this.db.prepare(`
      INSERT INTO assets
        (id, user_id, symbol, side, quantity, entry_price, cost_basis, stop_loss, take_profit, strategy_id, opened_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const pos of state.positions) {
      insertAsset.run(
        pos.id,
        userId,
        pos.symbol,
        pos.side,
        pos.quantity,
        pos.entryPrice,
        pos.costBasis,
        pos.stopLoss ?? null,
        pos.takeProfit ?? null,
        pos.strategyId,
        pos.openedAt,
        now
      );
    }

    // Sync order records
    const upsertOrder = this.db.prepare(`
      INSERT INTO orders
        (id, user_id, symbol, side, order_type, quantity, requested_price, executed_price, fee, reserved_cash, status, strategy_id, reject_reason, client_order_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        executed_price = excluded.executed_price,
        fee = excluded.fee,
        reserved_cash = excluded.reserved_cash,
        status = excluded.status,
        reject_reason = excluded.reject_reason,
        updated_at = excluded.updated_at
    `);
    for (const ord of state.orderHistory.slice(0, 200)) {
      upsertOrder.run(
        ord.id,
        userId,
        ord.symbol,
        ord.side,
        ord.type,
        ord.quantity,
        ord.requestedPrice,
        ord.executedPrice ?? null,
        ord.fee,
        ord.reservedCash,
        ord.status,
        ord.strategyId,
        ord.rejectReason ?? null,
        ord.createdAt,
        ord.updatedAt
      );
      if (recordOrderLedger) {
        if (ord.status === 'FILLED') {
          const execPrice = ord.executedPrice ?? ord.requestedPrice;
          const amount =
            ord.side === 'BUY'
              ? -(ord.quantity * execPrice + ord.fee)
              : ord.quantity * execPrice - ord.fee;
          this.insertLedgerEntrySync({
            userId,
            asset: ord.symbol,
            amount: Number(amount.toFixed(2)),
            balanceBefore: state.availableCash,
            balanceAfter: state.availableCash,
            txType: 'ORDER_FILL',
            referenceId: ord.id,
            idempotencyKey: `ord-fill-${ord.id}`,
            description: `${ord.side} ${ord.quantity} ${ord.symbol} (${ord.type}) @ $${execPrice.toFixed(2)}`,
            createdAt: ord.updatedAt,
          });
        } else if (ord.status === 'OPEN') {
          this.insertLedgerEntrySync({
            userId,
            asset: 'USDT',
            amount: -Number(ord.reservedCash.toFixed(2)),
            balanceBefore: state.availableCash,
            balanceAfter: state.availableCash,
            txType: 'ORDER_RESERVE',
            referenceId: ord.id,
            idempotencyKey: `ord-res-${ord.id}`,
            description: `Reserved paper cash for ${ord.side} LIMIT ${ord.quantity} ${ord.symbol}`,
            createdAt: ord.createdAt,
          });
        } else if (ord.status === 'CANCELLED') {
          this.insertLedgerEntrySync({
            userId,
            asset: 'USDT',
            amount: Number(ord.reservedCash.toFixed(2)),
            balanceBefore: state.availableCash,
            balanceAfter: state.availableCash,
            txType: 'ORDER_CANCEL_RELEASE',
            referenceId: ord.id,
            idempotencyKey: `ord-can-${ord.id}`,
            description: `Cancelled resting order ${ord.id} — released paper funds`,
            createdAt: ord.updatedAt,
          });
        }
      }
    }

    // Sync completed trades & ensure ledger settlement entries exist
    const insertTrade = this.db.prepare(`
      INSERT OR IGNORE INTO completed_trades
        (id, user_id, symbol, side, quantity, entry_price, exit_price, gross_pnl, fees_paid, net_pnl, return_pct, close_reason, strategy_id, opened_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const tr of state.closedTrades.slice(0, 200)) {
      const inserted = insertTrade.run(
        tr.id,
        userId,
        tr.symbol,
        tr.side,
        tr.quantity,
        tr.entryPrice,
        tr.exitPrice,
        tr.grossPnl,
        tr.feesPaid,
        tr.netPnl,
        tr.returnPct,
        tr.closeReason,
        tr.strategyId,
        tr.openedAt,
        tr.closedAt
      );
      if (Number(inserted.changes) > 0) {
        this.insertLedgerEntrySync({
          userId,
          asset: tr.symbol,
          amount: Number(tr.netPnl.toFixed(2)),
          balanceBefore: state.availableCash,
          balanceAfter: state.availableCash,
          txType: 'POSITION_SETTLEMENT',
          referenceId: tr.id,
          idempotencyKey: `stl-${tr.id}`,
          description: `Settled ${tr.side} ${tr.symbol} (${tr.closeReason})`,
          createdAt: tr.closedAt,
        });
      }
    }

    this.db
      .prepare(`
        INSERT INTO user_engine_snapshots (user_id, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `)
      .run(userId, JSON.stringify(state), now);
  }

  getUserTradingState(userId: string): { state: TradingEngineState; updatedAt: number } | null {
    const row = this.db
      .prepare('SELECT state_json, updated_at FROM user_engine_snapshots WHERE user_id = ?')
      .get(userId) as { state_json: string; updated_at: number } | undefined;
    if (!row) return null;
    try {
      return {
        state: JSON.parse(row.state_json) as TradingEngineState,
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return null;
    }
  }

  async saveUserTradingState(
    userId: string,
    state: TradingEngineState
  ): Promise<{ saved: true; updatedAt: number }> {
    this.validateTradingStatePayload(state);
    const now = Date.now();
    return this.runInTransaction(() => {
      const exists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
      if (!exists) {
        throw new Error('User account not found.');
      }
      this.persistEngineStateSync(userId, state, now, true);
      return { saved: true as const, updatedAt: now };
    });
  }

  executePaperOrder(
    userId: string,
    orderReq: OrderRequest,
    idempotencyKey?: string
  ): {
    accepted: boolean;
    errors: string[];
    order?: OrderRecord;
    state: TradingEngineState;
    updatedAt: number;
    transactionId: string | null;
  } {
    const cleanKey = idempotencyKey ? sanitizeText(idempotencyKey, 96) : undefined;
    const settings = this.getPlatformSettings();
    if (!settings.tradingEnabled) {
      throw new Error('Simulated trading is currently paused by the platform administrator.');
    }

    return this.runInTransaction(() => {
      const user = this.getPublicUserById(userId);
      if (!user) throw new Error('User account not found.');
      if (user.status !== 'ACTIVE') {
        throw new PermissionDeniedError('Account is suspended.');
      }

      if (cleanKey) {
        const dupOrder = this.db
          .prepare('SELECT id FROM orders WHERE user_id = ? AND client_order_id = ?')
          .get(userId, cleanKey);
        const dupLedger = this.db
          .prepare('SELECT id FROM ledger_transactions WHERE idempotency_key = ?')
          .get(`ord-key-${userId}-${cleanKey}`);
        if (dupOrder || dupLedger) {
          throw new DuplicateTransactionError(
            `Duplicate order rejected (idempotency key "${cleanKey}" already processed).`
          );
        }
      }

      const pair = this.db
        .prepare('SELECT enabled FROM trading_pairs WHERE symbol = ?')
        .get(orderReq.symbol) as { enabled: number } | undefined;
      if (pair && pair.enabled === 0) {
        throw new Error(`Trading pair ${orderReq.symbol} is currently disabled by administrator.`);
      }

      const current =
        this.getUserTradingState(userId)?.state ??
        createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });

      const prevCash = current.availableCash;
      const outcome = placeOrder(current, orderReq);
      const now = Date.now();

      this.persistEngineStateSync(userId, outcome.state, now, false);

      if (cleanKey && outcome.order) {
        this.db
          .prepare('UPDATE orders SET client_order_id = ? WHERE id = ?')
          .run(cleanKey, outcome.order.id);
      }

      let transactionId: string | null = null;
      if (outcome.accepted && outcome.order) {
        const ord = outcome.order;
        const cashDelta = Number((outcome.state.availableCash - prevCash).toFixed(2));
        if (ord.status === 'FILLED') {
          transactionId = this.insertLedgerEntrySync({
            userId,
            asset: ord.symbol,
            amount: cashDelta,
            balanceBefore: prevCash,
            balanceAfter: outcome.state.availableCash,
            txType: 'ORDER_FILL',
            referenceId: ord.id,
            idempotencyKey: cleanKey ? `ord-key-${userId}-${cleanKey}` : `ord-fill-${ord.id}`,
            description: `${ord.side} ${ord.quantity} ${ord.symbol} (${ord.type}) @ $${(ord.executedPrice ?? ord.requestedPrice).toFixed(2)}`,
            createdAt: now,
          });
        } else if (ord.status === 'OPEN') {
          transactionId = this.insertLedgerEntrySync({
            userId,
            asset: 'USDT',
            amount: -Number(ord.reservedCash.toFixed(2)),
            balanceBefore: prevCash,
            balanceAfter: outcome.state.availableCash,
            txType: 'ORDER_RESERVE',
            referenceId: ord.id,
            idempotencyKey: cleanKey ? `ord-key-${userId}-${cleanKey}` : `ord-res-${ord.id}`,
            description: `Reserved paper cash for ${ord.side} LIMIT ${ord.quantity} ${ord.symbol}`,
            createdAt: now,
          });
        }
      }

      return {
        accepted: outcome.accepted,
        errors: outcome.errors,
        order: outcome.order,
        state: outcome.state,
        updatedAt: now,
        transactionId,
      };
    });
  }

  cancelPaperOrder(
    userId: string,
    orderId: string
  ): { ok: true; orderId: string; state: TradingEngineState; updatedAt: number; transactionId: string | null } {
    return this.runInTransaction(() => {
      const current = this.getUserTradingState(userId)?.state;
      if (!current || !current.openOrders.some((o) => o.id === orderId)) {
        throw new Error('Open order not found.');
      }

      const prevCash = current.availableCash;
      const nextState = cancelOrder(current, orderId);
      const now = Date.now();
      this.persistEngineStateSync(userId, nextState, now, false);

      const released = Number((nextState.availableCash - prevCash).toFixed(2));
      const transactionId = this.insertLedgerEntrySync({
        userId,
        asset: 'USDT',
        amount: released,
        balanceBefore: prevCash,
        balanceAfter: nextState.availableCash,
        txType: 'ORDER_CANCEL_RELEASE',
        referenceId: orderId,
        idempotencyKey: `ord-can-${orderId}`,
        description: `Cancelled resting order ${orderId} — released $${released.toFixed(2)} paper funds`,
        createdAt: now,
      });

      return {
        ok: true as const,
        orderId,
        state: nextState,
        updatedAt: now,
        transactionId,
      };
    });
  }

  resetUserTradingState(
    userId: string,
    startingBalance: number
  ): { state: TradingEngineState; updatedAt: number; transactionId: string | null } {
    const cleanBalance = Number.isFinite(startingBalance) && startingBalance >= 1000
      ? Math.min(10_000_000, startingBalance)
      : 100_000;

    return this.runInTransaction(() => {
      const prevCash =
        this.getUserTradingState(userId)?.state.availableCash ?? cleanBalance;
      const next = createInitialEngineState({
        startingBalance: cleanBalance,
        seedDemoPositions: false,
      });
      const now = Date.now();
      this.persistEngineStateSync(userId, next, now);

      const transactionId = this.insertLedgerEntrySync({
        userId,
        asset: 'USDT',
        amount: Number((cleanBalance - prevCash).toFixed(2)),
        balanceBefore: prevCash,
        balanceAfter: cleanBalance,
        txType: 'VIRTUAL_RESET',
        referenceId: `rst-${now}`,
        idempotencyKey: `rst-${userId}-${now}-${crypto.randomBytes(4).toString('hex')}`,
        description: `Paper account reset to $${cleanBalance.toLocaleString('en-US')} virtual capital`,
        createdAt: now,
      });

      return { state: next, updatedAt: now, transactionId };
    });
  }

  executeSimulatedTransfer(
    userId: string,
    input: {
      direction: 'SIMULATED_DEPOSIT' | 'SIMULATED_WITHDRAWAL';
      amount: number;
      note?: string;
      idempotencyKey?: string;
    }
  ): {
    transfer: SimulatedTransferRecord;
    ledgerEntry: LedgerTransactionRecord;
    state: TradingEngineState;
    updatedAt: number;
  } {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Transfer amount must be a positive number.');
    }
    const roundedAmount = Number(amount.toFixed(2));
    const idempotencyKey =
      input.idempotencyKey && input.idempotencyKey.trim()
        ? sanitizeText(input.idempotencyKey, 96)
        : `trf-${crypto.randomUUID()}`;
    const note = sanitizeText(input.note ?? '', 140);

    return this.runInTransaction(() => {
      const user = this.getPublicUserById(userId);
      if (!user) throw new Error('User account not found.');
      if (user.status !== 'ACTIVE') {
        throw new PermissionDeniedError('Account is suspended.');
      }

      const dupTransfer = this.db
        .prepare('SELECT id FROM simulated_transfers WHERE idempotency_key = ?')
        .get(idempotencyKey);
      const dupLedger = this.db
        .prepare('SELECT id FROM ledger_transactions WHERE idempotency_key = ?')
        .get(idempotencyKey);
      if (dupTransfer || dupLedger) {
        throw new DuplicateTransactionError(
          `Duplicate simulated transfer blocked (idempotency key "${idempotencyKey}" already applied).`
        );
      }

      const settings = this.getPlatformSettings();
      if (
        input.direction === 'SIMULATED_DEPOSIT' &&
        roundedAmount > settings.maxSimulatedDeposit
      ) {
        throw new Error(
          `Simulated deposit exceeds platform limit of $${settings.maxSimulatedDeposit.toLocaleString('en-US')}.`
        );
      }

      const current =
        this.getUserTradingState(userId)?.state ??
        createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
      const prevCash = current.availableCash;

      if (input.direction === 'SIMULATED_WITHDRAWAL') {
        if (roundedAmount > prevCash + 1e-6) {
          throw new Error(
            `Insufficient available paper funds. Cannot withdraw $${roundedAmount.toFixed(2)} (available $${prevCash.toFixed(2)}).`
          );
        }
        if (current.startingBalance - roundedAmount <= 0) {
          throw new Error('Cannot reduce paper starting capital baseline to zero or below.');
        }
      }

      const signedDelta =
        input.direction === 'SIMULATED_DEPOSIT' ? roundedAmount : -roundedAmount;
      const nextCash = Number((prevCash + signedDelta).toFixed(2));
      const nextStarting = Number((current.startingBalance + signedDelta).toFixed(2));
      const now = Date.now();

      const transferId = `trf-${crypto.randomUUID()}`;
      this.db
        .prepare(`
          INSERT INTO simulated_transfers
            (id, user_id, direction, asset, amount, status, note, idempotency_key, created_at)
          VALUES (?, ?, ?, 'USDT', ?, 'COMPLETED', ?, ?, ?)
        `)
        .run(transferId, userId, input.direction, roundedAmount, note, idempotencyKey, now);

      const nextState: TradingEngineState = {
        ...current,
        startingBalance: nextStarting,
        availableCash: nextCash,
        lastUpdated: now,
      };
      this.persistEngineStateSync(userId, nextState, now);

      const txType =
        input.direction === 'SIMULATED_DEPOSIT' ? 'VIRTUAL_DEPOSIT' : 'SIMULATED_WITHDRAWAL';
      const desc =
        input.direction === 'SIMULATED_DEPOSIT'
          ? `Simulated paper deposit +$${roundedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}${note ? ` (${note})` : ''}`
          : `Simulated paper withdrawal -$${roundedAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}${note ? ` (${note})` : ''}`;

      const ledgerId = this.insertLedgerEntrySync({
        userId,
        asset: 'USDT',
        amount: signedDelta,
        balanceBefore: prevCash,
        balanceAfter: nextCash,
        txType,
        referenceId: transferId,
        idempotencyKey,
        description: desc,
        createdAt: now,
      });

      const ledgerRow = this.db
        .prepare('SELECT * FROM ledger_transactions WHERE id = ?')
        .get(ledgerId!) as Record<string, unknown>;

      return {
        transfer: {
          id: transferId,
          userId,
          direction: input.direction,
          asset: 'USDT',
          amount: roundedAmount,
          status: 'COMPLETED',
          note,
          idempotencyKey,
          createdAt: now,
        },
        ledgerEntry: this.mapLedgerRow(ledgerRow),
        state: nextState,
        updatedAt: now,
      };
    });
  }

  private mapLedgerRow(row: Record<string, unknown>): LedgerTransactionRecord {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      userEmail: typeof row.user_email === 'string' ? row.user_email : undefined,
      asset: String(row.asset),
      amount: Number(row.amount),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
      txType: row.tx_type as LedgerTransactionRecord['txType'],
      referenceId: row.reference_id ? String(row.reference_id) : null,
      idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
      description: String(row.description),
      mode: 'SIMULATED_PAPER',
      createdAt: Number(row.created_at),
    };
  }

  getUserLedger(userId: string, limit = 150): LedgerTransactionRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM ledger_transactions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(userId, Math.min(500, Math.max(1, limit))) as Record<string, unknown>[];
    return rows.map((r) => this.mapLedgerRow(r));
  }

  // ---- Platform Settings & Trading Pairs ----
  getPlatformSettings(): PlatformSettingsRecord {
    const now = Date.now();
    const defaults: PlatformSettingsRecord = {
      allowNewRegistrations: true,
      tradingEnabled: true,
      maxSimulatedDeposit: 250_000,
      maxSimulatedWithdrawal: 100_000,
      dailySimulatedWithdrawalLimit: 250_000,
      withdrawalApprovalThreshold: 10_000,
      requireAdminApprovalForTransfers: false,
      maintenanceNotice: '',
      updatedBy: 'SYSTEM',
      updatedAt: now,
    };
    const row = this.db
      .prepare(`SELECT value_json FROM platform_settings WHERE key = 'platform_config'`)
      .get() as { value_json: string } | undefined;
    if (!row) return defaults;
    try {
      const parsed = JSON.parse(row.value_json) as Partial<PlatformSettingsRecord>;
      return {
        ...defaults,
        ...parsed,
      };
    } catch {
      return defaults;
    }
  }

  listTradingPairs(): TradingPairConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM trading_pairs ORDER BY symbol ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      symbol: String(r.symbol),
      baseAsset: String(r.base_asset),
      quoteAsset: String(r.quote_asset),
      name: String(r.name),
      tickSize: Number(r.tick_size),
      minQty: Number(r.min_qty),
      enabled: Number(r.enabled) === 1,
      makerFeeRate: Number(r.maker_fee_rate),
      takerFeeRate: Number(r.taker_fee_rate),
      updatedAt: Number(r.updated_at),
    }));
  }

  // ---- Admin Functions & Audit Logs ----
  private insertAuditLogSync(input: {
    actorUserId: string | null;
    actorEmail: string;
    action: string;
    targetType: string;
    targetId: string | null;
    details: Record<string, unknown>;
    ipAddress: string | null;
    createdAt: number;
  }): void {
    this.db
      .prepare(`
        INSERT INTO admin_audit_logs
          (id, actor_user_id, actor_email, action, target_type, target_id, details_json, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        `aud-${crypto.randomUUID()}`,
        input.actorUserId,
        sanitizeText(input.actorEmail, 120),
        sanitizeText(input.action, 64),
        sanitizeText(input.targetType, 48),
        input.targetId ? sanitizeText(input.targetId, 96) : null,
        JSON.stringify(input.details ?? {}),
        input.ipAddress ? sanitizeText(input.ipAddress, 64) : null,
        input.createdAt
      );
  }

  recordSecurityAuditEvent(input: {
    actorUserId: string | null;
    actorEmail: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  }): void {
    this.insertAuditLogSync({
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      details: input.details ?? {},
      ipAddress: input.ipAddress ?? null,
      createdAt: Date.now(),
    });
  }

  // Server-internal role update helper (for admin setup or admin actions)
  setUserRoleInternal(userId: string, role: UserRole): PublicUserProfile {
    const now = Date.now();
    this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now, userId);
    const updated = this.getPublicUserById(userId);
    if (!updated) throw new Error('User not found.');
    return updated;
  }

  getAdminOverview(): {
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
  } {
    const now = Date.now();
    const uStats = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN role = 'ADMIN' THEN 1 ELSE 0 END) AS admins
        FROM users
      `)
      .get() as Record<string, number>;

    const ses = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL AND expires_at > ?')
      .get(now) as { cnt: number };
    const ord = this.db.prepare('SELECT COUNT(*) AS cnt FROM orders').get() as { cnt: number };
    const trd = this.db.prepare('SELECT COUNT(*) AS cnt FROM completed_trades').get() as { cnt: number };
    const led = this.db.prepare('SELECT COUNT(*) AS cnt FROM ledger_transactions').get() as { cnt: number };
    const bal = this.db
      .prepare('SELECT COALESCE(SUM(available_cash + reserved_cash), 0) AS sum_cash FROM balances')
      .get() as { sum_cash: number };

    return {
      usersTotal: Number(uStats.total ?? 0),
      activeUsers: Number(uStats.active ?? 0),
      suspendedUsers: Number(uStats.suspended ?? 0),
      adminUsers: Number(uStats.admins ?? 0),
      activeSessions: Number(ses.cnt ?? 0),
      ordersTotal: Number(ord.cnt ?? 0),
      completedTradesTotal: Number(trd.cnt ?? 0),
      ledgerTransactionsTotal: Number(led.cnt ?? 0),
      totalSimulatedPaperCash: Number(Number(bal.sum_cash ?? 0).toFixed(2)),
      settings: this.getPlatformSettings(),
    };
  }

  listAdminUsers(): Array<
    PublicUserProfile & {
      availableCash: number;
      reservedCash: number;
      openOrdersCount: number;
      completedTradesCount: number;
    }
  > {
    const rows = this.db
      .prepare(`
        SELECT
          u.*, p.bio, p.timezone, p.risk_tier,
          COALESCE(b.available_cash, 0) AS available_cash,
          COALESCE(b.reserved_cash, 0) AS reserved_cash,
          (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'OPEN') AS open_orders_count,
          (SELECT COUNT(*) FROM completed_trades t WHERE t.user_id = u.id) AS completed_trades_count
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        LEFT JOIN balances b ON b.user_id = u.id
        ORDER BY u.created_at DESC
      `)
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      ...this.mapPublicProfile(row),
      availableCash: Number(row.available_cash ?? 0),
      reservedCash: Number(row.reserved_cash ?? 0),
      openOrdersCount: Number(row.open_orders_count ?? 0),
      completedTradesCount: Number(row.completed_trades_count ?? 0),
    }));
  }

  adminUpdateUser(
    actorUserId: string,
    targetUserId: string,
    patch: { status?: AccountStatus; role?: UserRole; emailVerified?: boolean }
  ): PublicUserProfile {
    return this.runInTransaction(() => {
      const actor = this.getPublicUserById(actorUserId);
      const target = this.getPublicUserById(targetUserId);
      if (!actor || actor.role !== 'ADMIN') {
        throw new PermissionDeniedError('Admin privileges required.');
      }
      if (!target) {
        throw new Error('Target user not found.');
      }
      if (actorUserId === targetUserId && (patch.status === 'SUSPENDED' || patch.role === 'TRADER')) {
        throw new Error('Administrators cannot suspend or demote their own active account.');
      }

      const nextStatus = patch.status ?? target.status;
      const nextRole = patch.role ?? target.role;
      const nextVerified = patch.emailVerified !== undefined ? (patch.emailVerified ? 1 : 0) : (target.emailVerified ? 1 : 0);
      const now = Date.now();

      this.db
        .prepare('UPDATE users SET status = ?, role = ?, email_verified = ?, updated_at = ? WHERE id = ?')
        .run(nextStatus, nextRole, nextVerified, now, targetUserId);

      if (nextStatus === 'SUSPENDED') {
        this.revokeAllUserSessions(targetUserId);
      }

      this.insertAuditLogSync({
        actorUserId,
        actorEmail: actor.email,
        action: 'ADMIN_USER_UPDATED',
        targetType: 'USER',
        targetId: targetUserId,
        details: { nextStatus, nextRole, emailVerified: nextVerified === 1 },
        ipAddress: null,
        createdAt: now,
      });

      return this.getPublicUserById(targetUserId)!;
    });
  }

  listAdminOrders(limit = 100): Array<{
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
  }> {
    const rows = this.db
      .prepare(`
        SELECT o.*, u.email AS user_email
        FROM orders o
        JOIN users u ON u.id = o.user_id
        ORDER BY o.updated_at DESC
        LIMIT ?
      `)
      .all(Math.min(500, Math.max(1, limit))) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      userEmail: String(r.user_email),
      symbol: String(r.symbol),
      side: String(r.side),
      orderType: String(r.order_type),
      quantity: Number(r.quantity),
      requestedPrice: Number(r.requested_price),
      executedPrice: r.executed_price !== null ? Number(r.executed_price) : null,
      fee: Number(r.fee),
      status: String(r.status),
      createdAt: Number(r.created_at),
    }));
  }

  listAdminTransactions(limit = 150): LedgerTransactionRecord[] {
    const rows = this.db
      .prepare(`
        SELECT l.*, u.email AS user_email
        FROM ledger_transactions l
        JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC
        LIMIT ?
      `)
      .all(Math.min(500, Math.max(1, limit))) as Record<string, unknown>[];
    return rows.map((r) => this.mapLedgerRow(r));
  }

  updateTradingPair(
    actorUserId: string,
    symbol: string,
    patch: { enabled?: boolean; makerFeeRate?: number; takerFeeRate?: number }
  ): TradingPairConfig {
    return this.runInTransaction(() => {
      const actor = this.getPublicUserById(actorUserId);
      if (!actor || actor.role !== 'ADMIN') {
        throw new PermissionDeniedError('Admin privileges required.');
      }
      const existing = this.db
        .prepare('SELECT * FROM trading_pairs WHERE symbol = ?')
        .get(symbol) as Record<string, unknown> | undefined;
      if (!existing) throw new Error(`Unknown trading pair: ${symbol}`);

      const nextEnabled =
        patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : Number(existing.enabled);
      const nextMaker =
        patch.makerFeeRate !== undefined && Number.isFinite(patch.makerFeeRate) && patch.makerFeeRate >= 0 && patch.makerFeeRate <= 0.05
          ? patch.makerFeeRate
          : Number(existing.maker_fee_rate);
      const nextTaker =
        patch.takerFeeRate !== undefined && Number.isFinite(patch.takerFeeRate) && patch.takerFeeRate >= 0 && patch.takerFeeRate <= 0.05
          ? patch.takerFeeRate
          : Number(existing.taker_fee_rate);
      const now = Date.now();

      this.db
        .prepare(
          'UPDATE trading_pairs SET enabled = ?, maker_fee_rate = ?, taker_fee_rate = ?, updated_at = ? WHERE symbol = ?'
        )
        .run(nextEnabled, nextMaker, nextTaker, now, symbol);

      this.insertAuditLogSync({
        actorUserId,
        actorEmail: actor.email,
        action: 'ADMIN_PAIR_UPDATED',
        targetType: 'TRADING_PAIR',
        targetId: symbol,
        details: { enabled: nextEnabled === 1, makerFeeRate: nextMaker, takerFeeRate: nextTaker },
        ipAddress: null,
        createdAt: now,
      });

      return this.listTradingPairs().find((p) => p.symbol === symbol)!;
    });
  }

  updatePlatformSettings(
    actorUserId: string,
    patch: Partial<Omit<PlatformSettingsRecord, 'updatedBy' | 'updatedAt'>>
  ): PlatformSettingsRecord {
    return this.runInTransaction(() => {
      const actor = this.getPublicUserById(actorUserId);
      if (!actor || actor.role !== 'ADMIN') {
        throw new PermissionDeniedError('Admin privileges required.');
      }
      const current = this.getPlatformSettings();
      const now = Date.now();
      const next: PlatformSettingsRecord = {
        allowNewRegistrations:
          typeof patch.allowNewRegistrations === 'boolean'
            ? patch.allowNewRegistrations
            : current.allowNewRegistrations,
        tradingEnabled:
          typeof patch.tradingEnabled === 'boolean' ? patch.tradingEnabled : current.tradingEnabled,
        maxSimulatedDeposit:
          typeof patch.maxSimulatedDeposit === 'number' &&
          Number.isFinite(patch.maxSimulatedDeposit) &&
          patch.maxSimulatedDeposit >= 1000
            ? Math.min(10_000_000, patch.maxSimulatedDeposit)
            : current.maxSimulatedDeposit,
        maxSimulatedWithdrawal:
          typeof patch.maxSimulatedWithdrawal === 'number' &&
          Number.isFinite(patch.maxSimulatedWithdrawal) &&
          patch.maxSimulatedWithdrawal >= 100
            ? Math.min(10_000_000, patch.maxSimulatedWithdrawal)
            : current.maxSimulatedWithdrawal,
        dailySimulatedWithdrawalLimit:
          typeof patch.dailySimulatedWithdrawalLimit === 'number' &&
          Number.isFinite(patch.dailySimulatedWithdrawalLimit) &&
          patch.dailySimulatedWithdrawalLimit >= 500
            ? Math.min(25_000_000, patch.dailySimulatedWithdrawalLimit)
            : current.dailySimulatedWithdrawalLimit,
        withdrawalApprovalThreshold:
          typeof patch.withdrawalApprovalThreshold === 'number' &&
          Number.isFinite(patch.withdrawalApprovalThreshold) &&
          patch.withdrawalApprovalThreshold >= 0
            ? Math.min(10_000_000, patch.withdrawalApprovalThreshold)
            : current.withdrawalApprovalThreshold,
        requireAdminApprovalForTransfers:
          typeof patch.requireAdminApprovalForTransfers === 'boolean'
            ? patch.requireAdminApprovalForTransfers
            : current.requireAdminApprovalForTransfers,
        maintenanceNotice:
          typeof patch.maintenanceNotice === 'string'
            ? sanitizeText(patch.maintenanceNotice, 180)
            : current.maintenanceNotice,
        updatedBy: actor.email,
        updatedAt: now,
      };

      this.db
        .prepare(
          `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
           VALUES ('platform_config', ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`
        )
        .run(JSON.stringify(next), actor.email, now);

      this.insertAuditLogSync({
        actorUserId,
        actorEmail: actor.email,
        action: 'ADMIN_SETTINGS_UPDATED',
        targetType: 'PLATFORM_SETTINGS',
        targetId: 'platform_config',
        details: next as unknown as Record<string, unknown>,
        ipAddress: null,
        createdAt: now,
      });

      return next;
    });
  }

  // ---- Phase 5: User Wallets, Simulated Deposits/Withdrawals & Suspicious Activity Monitoring ----
  private backfillUserWallets(): void {
    const rows = this.db.prepare('SELECT id FROM users').all() as Array<{ id: string }>;
    const now = Date.now();
    for (const row of rows) {
      const state = this.getUserTradingState(row.id)?.state;
      const usdtBal = state ? state.availableCash : 100_000;
      this.ensureUserWalletSync(row.id, usdtBal, now);
    }
  }

  private ensureUserWalletSync(userId: string, usdtAvailable?: number, now = Date.now()): string {
    const existing = this.db
      .prepare('SELECT wallet_uid FROM user_wallets WHERE user_id = ?')
      .get(userId) as { wallet_uid: string } | undefined;
    let walletUid = existing?.wallet_uid;
    if (!walletUid) {
      walletUid = `WAL-77-${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 10).toUpperCase()}`;
      this.db
        .prepare(
          `INSERT OR IGNORE INTO user_wallets (user_id, wallet_uid, status, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, ?)`
        )
        .run(userId, walletUid, now, now);
    }

    const fallbackUsdt =
      usdtAvailable ??
      this.getUserTradingState(userId)?.state.availableCash ??
      100_000;

    const upsertAsset = this.db.prepare(`
      INSERT OR IGNORE INTO wallet_asset_balances (id, user_id, asset, available_balance, reserved_balance, updated_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `);
    for (const asset of SUPPORTED_WALLET_ASSETS) {
      const initial = asset === 'USDT' ? Number(Math.max(0, fallbackUsdt).toFixed(2)) : 0;
      upsertAsset.run(`wbal-${userId}-${asset}`, userId, asset, initial, now);
    }

    return walletUid;
  }

  private getAssetUsdPriceSync(userId: string, asset: WalletAsset): number {
    if (asset === 'USDT') return 1;
    const sym = `${asset}USDT`;
    const state = this.getUserTradingState(userId)?.state;
    const liveOrCached = state?.markets?.[sym]?.price;
    if (typeof liveOrCached === 'number' && Number.isFinite(liveOrCached) && liveOrCached > 0) {
      return liveOrCached;
    }
    const spec = INITIAL_MARKET_SPECS.find((m) => m.baseAsset === asset);
    return spec?.basePrice ?? 1;
  }

  private roundAssetAmount(asset: WalletAsset, value: number): number {
    const decimals = asset === 'USDT' ? 2 : 8;
    return Number(value.toFixed(decimals));
  }

  private mapWalletTxRow(row: Record<string, unknown>): WalletTransactionRecord {
    let instruction: SimulatedDepositInstruction | null = null;
    if (typeof row.instruction_json === 'string' && row.instruction_json) {
      try {
        instruction = JSON.parse(row.instruction_json) as SimulatedDepositInstruction;
      } catch {
        instruction = null;
      }
    }
    return {
      id: String(row.id),
      userId: String(row.user_id),
      userEmail: typeof row.user_email === 'string' ? row.user_email : undefined,
      walletUid: String(row.wallet_uid),
      direction: row.direction === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT',
      asset: String(row.asset) as WalletAsset,
      amount: Number(row.amount),
      usdEquivalent: Number(row.usd_equivalent),
      fee: Number(row.fee),
      netAmount: Number(row.net_amount),
      providerId: String(row.provider_id),
      providerName: String(row.provider_name),
      paymentRail: String(row.payment_rail) as PaymentRailType,
      destinationOrSource: String(row.destination_or_source),
      referenceCode: String(row.reference_code),
      idempotencyKey: String(row.idempotency_key),
      status: String(row.status) as WalletTransactionStatus,
      note: typeof row.note === 'string' ? row.note : '',
      rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
      instruction,
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
      reviewedAt: row.reviewed_at !== null ? Number(row.reviewed_at) : null,
      mode: 'SIMULATED_PAPER',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private insertSuspiciousAlertSync(input: {
    userId: string;
    userEmail: string;
    transactionId: string | null;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    ruleCode: string;
    description: string;
    createdAt: number;
  }): void {
    this.db
      .prepare(`
        INSERT INTO suspicious_activity_alerts
          (id, user_id, user_email, transaction_id, severity, rule_code, description, status, resolved_by, resolved_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, NULL, ?)
      `)
      .run(
        `alrt-${crypto.randomUUID()}`,
        input.userId,
        sanitizeText(input.userEmail, 120),
        input.transactionId,
        input.severity,
        sanitizeText(input.ruleCode, 64),
        sanitizeText(input.description, 240),
        input.createdAt
      );
  }

  private evaluateVelocityAndThresholdAlertsSync(input: {
    userId: string;
    userEmail: string;
    txId: string;
    direction: 'DEPOSIT' | 'WITHDRAWAL';
    asset: WalletAsset;
    amount: number;
    usdEquivalent: number;
    settings: PlatformSettingsRecord;
    now: number;
  }): void {
    if (input.usdEquivalent >= input.settings.withdrawalApprovalThreshold) {
      this.insertSuspiciousAlertSync({
        userId: input.userId,
        userEmail: input.userEmail,
        transactionId: input.txId,
        severity: input.usdEquivalent >= input.settings.withdrawalApprovalThreshold * 2.5 ? 'HIGH' : 'MEDIUM',
        ruleCode: 'THRESHOLD_EXCEEDED_REVIEW',
        description: `Simulated ${input.direction.toLowerCase()} of ${input.amount} ${input.asset} (~$${input.usdEquivalent.toFixed(2)}) reached admin review threshold ($${input.settings.withdrawalApprovalThreshold.toLocaleString('en-US')}).`,
        createdAt: input.now,
      });
    }

    const recentWindow = input.now - 10 * 60 * 1000;
    const recentCountRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM wallet_transactions WHERE user_id = ? AND created_at >= ?')
      .get(input.userId, recentWindow) as { cnt: number };
    if (Number(recentCountRow.cnt) >= 4) {
      this.insertSuspiciousAlertSync({
        userId: input.userId,
        userEmail: input.userEmail,
        transactionId: input.txId,
        severity: 'MEDIUM',
        ruleCode: 'HIGH_TRANSFER_VELOCITY',
        description: `High transfer velocity: ${recentCountRow.cnt} simulated wallet requests within 10 minutes.`,
        createdAt: input.now,
      });
    }
  }

  private get24hWithdrawalUsedUsdSync(userId: string, now: number): number {
    const since = now - 24 * 60 * 60 * 1000;
    const row = this.db
      .prepare(`
        SELECT COALESCE(SUM(usd_equivalent), 0) AS total_usd
        FROM wallet_transactions
        WHERE user_id = ? AND direction = 'WITHDRAWAL' AND status != 'REJECTED' AND created_at >= ?
      `)
      .get(userId, since) as { total_usd: number };
    return Number(Number(row.total_usd ?? 0).toFixed(2));
  }

  getUserWalletSummary(userId: string): UserWalletSummary {
    const user = this.getPublicUserById(userId);
    if (!user) throw new Error('User account not found.');

    const now = Date.now();
    const state =
      this.getUserTradingState(userId)?.state ??
      createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
    const walletUid = this.ensureUserWalletSync(userId, state.availableCash, now);

    // Ensure USDT available mirrors trading engine cash
    this.db
      .prepare(
        `UPDATE wallet_asset_balances SET available_balance = ?, updated_at = ? WHERE user_id = ? AND asset = 'USDT'`
      )
      .run(Number(Math.max(0, state.availableCash).toFixed(2)), now, userId);

    const walletRow = this.db
      .prepare('SELECT status, updated_at FROM user_wallets WHERE user_id = ?')
      .get(userId) as { status: 'ACTIVE' | 'FROZEN'; updated_at: number };

    const balRows = this.db
      .prepare('SELECT * FROM wallet_asset_balances WHERE user_id = ?')
      .all(userId) as Array<Record<string, unknown>>;

    const byAsset = new Map<string, Record<string, unknown>>();
    for (const r of balRows) {
      byAsset.set(String(r.asset), r);
    }

    const metrics = computePerformanceMetrics(state);
    let totalWalletUsdValue = 0;

    const assets: WalletAssetBalanceRecord[] = SUPPORTED_WALLET_ASSETS.map((asset) => {
      const row = byAsset.get(asset);
      const availableBalance = Number(row?.available_balance ?? 0);
      const reservedBalance = Number(row?.reserved_balance ?? 0);
      const totalBalance = this.roundAssetAmount(asset, availableBalance + reservedBalance);
      const estimatedUsdPrice = this.getAssetUsdPriceSync(userId, asset);
      const estimatedUsdValue = Number((totalBalance * estimatedUsdPrice).toFixed(2));
      totalWalletUsdValue += estimatedUsdValue;

      return {
        asset,
        availableBalance,
        reservedBalance,
        totalBalance,
        estimatedUsdPrice,
        estimatedUsdValue,
        updatedAt: Number(row?.updated_at ?? now),
      };
    });

    // Include open-order margin reserved cash + open position mark value in total portfolio value
    const openPositionsValue = Number(
      Math.max(0, metrics.totalEquity - metrics.availableCash - metrics.reservedCash).toFixed(2)
    );
    const totalPortfolioUsdValue = Number(
      (totalWalletUsdValue + metrics.reservedCash + openPositionsValue).toFixed(2)
    );

    const txRows = this.db
      .prepare(`
        SELECT w.*, u.email AS user_email
        FROM wallet_transactions w
        JOIN users u ON u.id = w.user_id
        WHERE w.user_id = ?
        ORDER BY w.created_at DESC
        LIMIT 120
      `)
      .all(userId) as Array<Record<string, unknown>>;

    const usdtRow = byAsset.get('USDT');
    const settings = this.getPlatformSettings();

    return {
      walletUid,
      userId,
      status: walletRow?.status === 'FROZEN' ? 'FROZEN' : 'ACTIVE',
      mode: 'SIMULATED_PAPER_ONLY',
      totalWalletUsdValue: Number(totalWalletUsdValue.toFixed(2)),
      totalOpenPositionsUsdValue: openPositionsValue,
      totalPortfolioUsdValue,
      availableUsdt: Number(usdtRow?.available_balance ?? state.availableCash),
      reservedUsdtForOrders: metrics.reservedCash,
      reservedUsdtForWithdrawals: Number(usdtRow?.reserved_balance ?? 0),
      dailyWithdrawalUsedUsd: this.get24hWithdrawalUsedUsdSync(userId, now),
      dailyWithdrawalLimitUsd: settings.dailySimulatedWithdrawalLimit,
      maxSingleWithdrawalUsd: settings.maxSimulatedWithdrawal,
      maxSingleDepositUsd: settings.maxSimulatedDeposit,
      withdrawalApprovalThresholdUsd: settings.withdrawalApprovalThreshold,
      requireAdminApprovalForTransfers: settings.requireAdminApprovalForTransfers,
      assets,
      transactions: txRows.map((r) => this.mapWalletTxRow(r)),
      updatedAt: Number(walletRow?.updated_at ?? now),
    };
  }

  getUserWalletTransactions(userId: string, limit = 120): WalletTransactionRecord[] {
    const rows = this.db
      .prepare(`
        SELECT w.*, u.email AS user_email
        FROM wallet_transactions w
        JOIN users u ON u.id = w.user_id
        WHERE w.user_id = ?
        ORDER BY w.created_at DESC
        LIMIT ?
      `)
      .all(userId, Math.min(300, Math.max(1, limit))) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapWalletTxRow(r));
  }

  createSimulatedDeposit(
    userId: string,
    input: {
      asset: string;
      amount: number;
      providerId?: string;
      note?: string;
      idempotencyKey?: string;
      requestManualReview?: boolean;
    }
  ): {
    transaction: WalletTransactionRecord;
    wallet: UserWalletSummary;
    state: TradingEngineState;
  } {
    const assetUpper = String(input.asset ?? '').trim().toUpperCase();
    if (!isSupportedWalletAsset(assetUpper)) {
      throw new Error(`Unsupported wallet asset "${assetUpper}".`);
    }
    const rawAmount = Number(input.amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      throw new Error('Deposit amount must be a positive number.');
    }
    const amount = this.roundAssetAmount(assetUpper, rawAmount);
    if (amount <= 0) {
      throw new Error('Deposit amount is below minimum precision.');
    }

    const providerId = String(input.providerId || 'sim_sandbox_rail').trim();
    const adapter = paymentRegistry.getAdapter(providerId);
    if (!adapter) {
      throw new Error(`Unknown payment adapter "${providerId}".`);
    }
    if (!adapter.supportedAssets.includes(assetUpper)) {
      throw new Error(
        `${adapter.name} only supports ${adapter.supportedAssets.join(', ')} in simulated mode.`
      );
    }

    const idempotencyKey =
      input.idempotencyKey && input.idempotencyKey.trim()
        ? sanitizeText(input.idempotencyKey, 96)
        : `wdep-${crypto.randomUUID()}`;
    const note = sanitizeText(input.note ?? '', 140);

    return this.runInTransaction(() => {
      const user = this.getPublicUserById(userId);
      if (!user) throw new Error('User account not found.');
      if (user.status !== 'ACTIVE') {
        throw new PermissionDeniedError('Account is suspended.');
      }

      const dupTx = this.db
        .prepare('SELECT id FROM wallet_transactions WHERE idempotency_key = ?')
        .get(idempotencyKey);
      const dupLedger = this.db
        .prepare('SELECT id FROM ledger_transactions WHERE idempotency_key = ?')
        .get(idempotencyKey);
      if (dupTx || dupLedger) {
        throw new DuplicateTransactionError(
          `Duplicate simulated deposit prevented (idempotency key "${idempotencyKey}" already applied).`
        );
      }

      const currentState =
        this.getUserTradingState(userId)?.state ??
        createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
      const now = Date.now();
      const walletUid = this.ensureUserWalletSync(userId, currentState.availableCash, now);
      const usdPrice = this.getAssetUsdPriceSync(userId, assetUpper);
      const usdEquivalent = Number((amount * usdPrice).toFixed(2));
      const settings = this.getPlatformSettings();

      if (usdEquivalent > settings.maxSimulatedDeposit) {
        throw new Error(
          `Simulated deposit value (~$${usdEquivalent.toLocaleString('en-US')}) exceeds platform single-deposit limit ($${settings.maxSimulatedDeposit.toLocaleString('en-US')}).`
        );
      }

      const txId = `wtx-${crypto.randomUUID()}`;
      const referenceCode = `DEP-77-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const instruction = adapter.createSimulatedDepositInstruction({
        userId,
        asset: assetUpper,
        amount,
        referenceCode,
      });

      const needsReview =
        Boolean(input.requestManualReview) ||
        settings.requireAdminApprovalForTransfers ||
        usdEquivalent >= settings.withdrawalApprovalThreshold;
      const status: WalletTransactionStatus = needsReview ? 'PENDING' : 'COMPLETED';

      this.db
        .prepare(`
          INSERT INTO wallet_transactions
            (id, user_id, wallet_uid, direction, asset, amount, usd_equivalent, fee, net_amount, provider_id, provider_name, payment_rail, destination_or_source, reference_code, idempotency_key, status, note, rejection_reason, instruction_json, reviewed_by, reviewed_at, mode, created_at, updated_at)
          VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'SIMULATED_PAPER', ?, ?)
        `)
        .run(
          txId,
          userId,
          walletUid,
          assetUpper,
          amount,
          usdEquivalent,
          amount,
          adapter.id,
          adapter.name,
          adapter.railType,
          instruction.simulatedDestination,
          referenceCode,
          idempotencyKey,
          status,
          note,
          JSON.stringify(instruction),
          now,
          now
        );

      let nextState = currentState;
      if (status === 'COMPLETED') {
        const balRow = this.db
          .prepare('SELECT available_balance FROM wallet_asset_balances WHERE user_id = ? AND asset = ?')
          .get(userId, assetUpper) as { available_balance: number };
        const prevBal = Number(balRow?.available_balance ?? 0);
        const nextBal = this.roundAssetAmount(assetUpper, prevBal + amount);

        this.db
          .prepare(
            `UPDATE wallet_asset_balances SET available_balance = ?, updated_at = ? WHERE user_id = ? AND asset = ?`
          )
          .run(nextBal, now, userId, assetUpper);

        if (assetUpper === 'USDT') {
          nextState = {
            ...currentState,
            startingBalance: Number((currentState.startingBalance + amount).toFixed(2)),
            availableCash: nextBal,
            lastUpdated: now,
          };
          this.persistEngineStateSync(userId, nextState, now, false);
        }

        this.insertLedgerEntrySync({
          userId,
          asset: assetUpper,
          amount,
          balanceBefore: prevBal,
          balanceAfter: nextBal,
          txType: 'VIRTUAL_DEPOSIT',
          referenceId: txId,
          idempotencyKey: `wdep-settle-${txId}`,
          description: `[WALLET DEPOSIT ${referenceCode}] +${amount} ${assetUpper} via ${adapter.railType}${note ? ` (${note})` : ''}`,
          createdAt: now,
        });
      }

      this.evaluateVelocityAndThresholdAlertsSync({
        userId,
        userEmail: user.email,
        txId,
        direction: 'DEPOSIT',
        asset: assetUpper,
        amount,
        usdEquivalent,
        settings,
        now,
      });

      const txRow = this.db
        .prepare('SELECT w.*, u.email AS user_email FROM wallet_transactions w JOIN users u ON u.id = w.user_id WHERE w.id = ?')
        .get(txId) as Record<string, unknown>;

      return {
        transaction: this.mapWalletTxRow(txRow),
        wallet: this.getUserWalletSummary(userId),
        state: nextState,
      };
    });
  }

  createSimulatedWithdrawal(
    userId: string,
    input: {
      asset: string;
      amount: number;
      destination: string;
      providerId?: string;
      confirmed?: boolean;
      note?: string;
      idempotencyKey?: string;
      requestManualReview?: boolean;
    }
  ): {
    transaction: WalletTransactionRecord;
    wallet: UserWalletSummary;
    state: TradingEngineState;
  } {
    if (input.confirmed !== true) {
      throw new Error('Explicit user confirmation is required before submitting a simulated withdrawal.');
    }

    const assetUpper = String(input.asset ?? '').trim().toUpperCase();
    if (!isSupportedWalletAsset(assetUpper)) {
      throw new Error(`Unsupported wallet asset "${assetUpper}".`);
    }
    const rawAmount = Number(input.amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      throw new Error('Withdrawal amount must be a positive number.');
    }
    const amount = this.roundAssetAmount(assetUpper, rawAmount);
    if (amount <= 0) {
      throw new Error('Withdrawal amount is below minimum precision.');
    }

    const providerId = String(input.providerId || 'sim_sandbox_rail').trim();
    const adapter = paymentRegistry.getAdapter(providerId);
    if (!adapter) {
      throw new Error(`Unknown payment adapter "${providerId}".`);
    }
    if (!adapter.supportedAssets.includes(assetUpper)) {
      throw new Error(
        `${adapter.name} only supports ${adapter.supportedAssets.join(', ')} in simulated mode.`
      );
    }

    const destCheck = adapter.validateWithdrawalDestination({
      asset: assetUpper,
      destination: String(input.destination ?? ''),
    });
    if (!destCheck.valid) {
      throw new Error(destCheck.error ?? 'Invalid simulated withdrawal destination.');
    }

    const idempotencyKey =
      input.idempotencyKey && input.idempotencyKey.trim()
        ? sanitizeText(input.idempotencyKey, 96)
        : `wwdr-${crypto.randomUUID()}`;
    const note = sanitizeText(input.note ?? '', 140);

    interface PendingAlertPayload {
      userId: string;
      userEmail: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
      ruleCode: string;
      description: string;
      createdAt: number;
    }
    const alertHolder: { value: PendingAlertPayload | null } = { value: null };

    try {
      return this.runInTransaction(() => {
        const user = this.getPublicUserById(userId);
        if (!user) throw new Error('User account not found.');
        if (user.status !== 'ACTIVE') {
          throw new PermissionDeniedError('Account is suspended.');
        }

        const dupTx = this.db
          .prepare('SELECT id FROM wallet_transactions WHERE idempotency_key = ?')
          .get(idempotencyKey);
        const dupLedger = this.db
          .prepare('SELECT id FROM ledger_transactions WHERE idempotency_key = ?')
          .get(idempotencyKey);
        if (dupTx || dupLedger) {
          throw new DuplicateTransactionError(
            `Duplicate simulated withdrawal prevented (idempotency key "${idempotencyKey}" already processed).`
          );
        }

        const currentState =
          this.getUserTradingState(userId)?.state ??
          createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
        const now = Date.now();
        const walletUid = this.ensureUserWalletSync(userId, currentState.availableCash, now);

        // Keep USDT wallet available synchronized before checking spendable balance
        this.db
          .prepare(
            `UPDATE wallet_asset_balances SET available_balance = ?, updated_at = ? WHERE user_id = ? AND asset = 'USDT'`
          )
          .run(Number(Math.max(0, currentState.availableCash).toFixed(2)), now, userId);

        const balRow = this.db
          .prepare(
            'SELECT available_balance, reserved_balance FROM wallet_asset_balances WHERE user_id = ? AND asset = ?'
          )
          .get(userId, assetUpper) as { available_balance: number; reserved_balance: number };

        const availableBal = Number(balRow?.available_balance ?? 0);
        const reservedBal = Number(balRow?.reserved_balance ?? 0);

        if (amount > availableBal + 1e-9) {
          alertHolder.value = {
            userId,
            userEmail: user.email,
            severity: 'MEDIUM',
            ruleCode: 'INSUFFICIENT_BALANCE_WITHDRAWAL',
            description: `Blocked simulated withdrawal of ${amount} ${assetUpper}; available balance was ${availableBal} ${assetUpper}.`,
            createdAt: now,
          };
          throw new Error(
            `Insufficient available ${assetUpper} balance. Requested ${amount} ${assetUpper}, available ${availableBal} ${assetUpper}.`
          );
        }

        const settings = this.getPlatformSettings();
        const usdPrice = this.getAssetUsdPriceSync(userId, assetUpper);
        const usdEquivalent = Number((amount * usdPrice).toFixed(2));

        if (usdEquivalent > settings.maxSimulatedWithdrawal) {
          alertHolder.value = {
            userId,
            userEmail: user.email,
            severity: 'MEDIUM',
            ruleCode: 'SINGLE_WITHDRAWAL_LIMIT_EXCEEDED',
            description: `Blocked simulated withdrawal (~$${usdEquivalent.toFixed(2)}) exceeding single withdrawal limit ($${settings.maxSimulatedWithdrawal.toLocaleString('en-US')}).`,
            createdAt: now,
          };
          throw new Error(
            `Withdrawal value (~$${usdEquivalent.toLocaleString('en-US')}) exceeds single-withdrawal limit of $${settings.maxSimulatedWithdrawal.toLocaleString('en-US')}.`
          );
        }

        const used24h = this.get24hWithdrawalUsedUsdSync(userId, now);
        if (used24h + usdEquivalent > settings.dailySimulatedWithdrawalLimit + 0.01) {
          alertHolder.value = {
            userId,
            userEmail: user.email,
            severity: 'HIGH',
            ruleCode: 'DAILY_WITHDRAWAL_LIMIT_EXCEEDED',
            description: `Blocked simulated withdrawal (~$${usdEquivalent.toFixed(2)}): 24h cumulative volume would reach $${(used24h + usdEquivalent).toFixed(2)} vs daily limit $${settings.dailySimulatedWithdrawalLimit.toLocaleString('en-US')}.`,
            createdAt: now,
          };
          throw new Error(
            `Daily simulated withdrawal limit ($${settings.dailySimulatedWithdrawalLimit.toLocaleString('en-US')}) exceeded. 24h used: $${used24h.toLocaleString('en-US')}.`
          );
        }

        const needsReview =
          Boolean(input.requestManualReview) ||
          settings.requireAdminApprovalForTransfers ||
          usdEquivalent >= settings.withdrawalApprovalThreshold;
        const status: WalletTransactionStatus = needsReview ? 'PENDING' : 'COMPLETED';

        const txId = `wtx-${crypto.randomUUID()}`;
        const referenceCode = `WDR-77-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const nextAvailable = this.roundAssetAmount(assetUpper, Math.max(0, availableBal - amount));
        const nextReserved =
          status === 'PENDING'
            ? this.roundAssetAmount(assetUpper, reservedBal + amount)
            : reservedBal;

        // Immediately deduct available balance (and lock into reservedBalance if PENDING) inside transaction to block double-spend
        this.db
          .prepare(
            `UPDATE wallet_asset_balances SET available_balance = ?, reserved_balance = ?, updated_at = ? WHERE user_id = ? AND asset = ?`
          )
          .run(nextAvailable, nextReserved, now, userId, assetUpper);

        this.db
          .prepare(`
            INSERT INTO wallet_transactions
              (id, user_id, wallet_uid, direction, asset, amount, usd_equivalent, fee, net_amount, provider_id, provider_name, payment_rail, destination_or_source, reference_code, idempotency_key, status, note, rejection_reason, instruction_json, reviewed_by, reviewed_at, mode, created_at, updated_at)
            VALUES (?, ?, ?, 'WITHDRAWAL', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'SIMULATED_PAPER', ?, ?)
          `)
          .run(
            txId,
            userId,
            walletUid,
            assetUpper,
            amount,
            usdEquivalent,
            amount,
            adapter.id,
            adapter.name,
            adapter.railType,
            destCheck.normalizedDestination,
            referenceCode,
            idempotencyKey,
            status,
            note,
            now,
            now
          );

        let nextState = currentState;
        if (assetUpper === 'USDT') {
          nextState = {
            ...currentState,
            startingBalance: Math.max(
              1,
              Number((currentState.startingBalance - (status === 'COMPLETED' ? amount : 0)).toFixed(2))
            ),
            availableCash: nextAvailable,
            lastUpdated: now,
          };
          this.persistEngineStateSync(userId, nextState, now, false);
        }

        if (status === 'PENDING') {
          this.insertLedgerEntrySync({
            userId,
            asset: assetUpper,
            amount: -amount,
            balanceBefore: availableBal,
            balanceAfter: nextAvailable,
            txType: 'WALLET_WITHDRAWAL_RESERVE',
            referenceId: txId,
            idempotencyKey: `wwdr-res-${txId}`,
            description: `[WITHDRAWAL RESERVED ${referenceCode}] Locked ${amount} ${assetUpper} pending admin review -> ${destCheck.normalizedDestination}`,
            createdAt: now,
          });
        } else {
          this.insertLedgerEntrySync({
            userId,
            asset: assetUpper,
            amount: -amount,
            balanceBefore: availableBal,
            balanceAfter: nextAvailable,
            txType: 'SIMULATED_WITHDRAWAL',
            referenceId: txId,
            idempotencyKey: `wwdr-settle-${txId}`,
            description: `[WALLET WITHDRAWAL ${referenceCode}] -${amount} ${assetUpper} via ${adapter.railType} -> ${destCheck.normalizedDestination}`,
            createdAt: now,
          });
        }

        this.evaluateVelocityAndThresholdAlertsSync({
          userId,
          userEmail: user.email,
          txId,
          direction: 'WITHDRAWAL',
          asset: assetUpper,
          amount,
          usdEquivalent,
          settings,
          now,
        });

        const txRow = this.db
          .prepare('SELECT w.*, u.email AS user_email FROM wallet_transactions w JOIN users u ON u.id = w.user_id WHERE w.id = ?')
          .get(txId) as Record<string, unknown>;

        return {
          transaction: this.mapWalletTxRow(txRow),
          wallet: this.getUserWalletSummary(userId),
          state: nextState,
        };
      });
    } catch (err) {
      if (alertHolder.value) {
        try {
          this.insertSuspiciousAlertSync({
            userId: alertHolder.value.userId,
            userEmail: alertHolder.value.userEmail,
            severity: alertHolder.value.severity,
            ruleCode: alertHolder.value.ruleCode,
            description: alertHolder.value.description,
            createdAt: alertHolder.value.createdAt,
            transactionId: null,
          });
        } catch {
          // Do not mask primary validation error
        }
      }
      throw err;
    }
  }

  adminListWalletTransactions(statusFilter?: string, limit = 150): WalletTransactionRecord[] {
    const cleanFilter =
      statusFilter && ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(statusFilter.toUpperCase())
        ? statusFilter.toUpperCase()
        : null;
    const rows = cleanFilter
      ? (this.db
          .prepare(`
            SELECT w.*, u.email AS user_email
            FROM wallet_transactions w
            JOIN users u ON u.id = w.user_id
            WHERE w.status = ?
            ORDER BY w.created_at DESC
            LIMIT ?
          `)
          .all(cleanFilter, Math.min(300, Math.max(1, limit))) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(`
            SELECT w.*, u.email AS user_email
            FROM wallet_transactions w
            JOIN users u ON u.id = w.user_id
            ORDER BY w.created_at DESC
            LIMIT ?
          `)
          .all(Math.min(300, Math.max(1, limit))) as Array<Record<string, unknown>>);

    return rows.map((r) => this.mapWalletTxRow(r));
  }

  adminReviewWalletTransaction(
    actorUserId: string,
    txId: string,
    input: {
      decision: 'APPROVE' | 'COMPLETE' | 'REJECT';
      reason?: string;
    }
  ): WalletTransactionRecord {
    return this.runInTransaction(() => {
      const actor = this.getPublicUserById(actorUserId);
      if (!actor || actor.role !== 'ADMIN') {
        throw new PermissionDeniedError('Admin privileges required to review wallet transactions.');
      }

      const row = this.db
        .prepare('SELECT w.*, u.email AS user_email FROM wallet_transactions w JOIN users u ON u.id = w.user_id WHERE w.id = ?')
        .get(txId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Wallet transaction not found.');
      }

      const tx = this.mapWalletTxRow(row);
      if (tx.status === 'COMPLETED' || tx.status === 'REJECTED') {
        throw new Error(
          `Transaction ${tx.referenceCode} is already ${tx.status} and cannot be modified.`
        );
      }

      const now = Date.now();
      const targetUserId = tx.userId;
      const asset = tx.asset;
      const reason = input.reason ? sanitizeText(input.reason, 180) : null;

      this.ensureUserWalletSync(targetUserId, undefined, now);
      const balRow = this.db
        .prepare(
          'SELECT available_balance, reserved_balance FROM wallet_asset_balances WHERE user_id = ? AND asset = ?'
        )
        .get(targetUserId, asset) as { available_balance: number; reserved_balance: number };

      const prevAvailable = Number(balRow?.available_balance ?? 0);
      const prevReserved = Number(balRow?.reserved_balance ?? 0);
      let nextStatus: WalletTransactionStatus;

      if (tx.direction === 'DEPOSIT') {
        if (input.decision === 'APPROVE' || input.decision === 'COMPLETE') {
          nextStatus = 'COMPLETED';
          const nextAvailable = this.roundAssetAmount(asset, prevAvailable + tx.amount);
          this.db
            .prepare(
              `UPDATE wallet_asset_balances SET available_balance = ?, updated_at = ? WHERE user_id = ? AND asset = ?`
            )
            .run(nextAvailable, now, targetUserId, asset);

          if (asset === 'USDT') {
            const st =
              this.getUserTradingState(targetUserId)?.state ??
              createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
            const updatedState: TradingEngineState = {
              ...st,
              startingBalance: Number((st.startingBalance + tx.amount).toFixed(2)),
              availableCash: nextAvailable,
              lastUpdated: now,
            };
            this.persistEngineStateSync(targetUserId, updatedState, now, false);
          }

          this.insertLedgerEntrySync({
            userId: targetUserId,
            asset,
            amount: tx.amount,
            balanceBefore: prevAvailable,
            balanceAfter: nextAvailable,
            txType: 'VIRTUAL_DEPOSIT',
            referenceId: tx.id,
            idempotencyKey: `wdep-settle-${tx.id}`,
            description: `[ADMIN APPROVED DEPOSIT ${tx.referenceCode}] +${tx.amount} ${asset} approved by ${actor.email}`,
            createdAt: now,
          });
        } else {
          nextStatus = 'REJECTED';
        }
      } else {
        // WITHDRAWAL state machine: PENDING -> APPROVED -> COMPLETED | REJECTED
        if (input.decision === 'APPROVE') {
          if (tx.status !== 'PENDING') {
            throw new Error(`Cannot approve withdrawal already in ${tx.status} state.`);
          }
          nextStatus = 'APPROVED';
        } else if (input.decision === 'COMPLETE') {
          nextStatus = 'COMPLETED';
          const nextReserved = this.roundAssetAmount(asset, Math.max(0, prevReserved - tx.amount));
          this.db
            .prepare(
              `UPDATE wallet_asset_balances SET reserved_balance = ?, updated_at = ? WHERE user_id = ? AND asset = ?`
            )
            .run(nextReserved, now, targetUserId, asset);

          if (asset === 'USDT') {
            const st =
              this.getUserTradingState(targetUserId)?.state ??
              createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
            const updatedState: TradingEngineState = {
              ...st,
              startingBalance: Math.max(1, Number((st.startingBalance - tx.amount).toFixed(2))),
              lastUpdated: now,
            };
            this.persistEngineStateSync(targetUserId, updatedState, now, false);
          }

          this.insertLedgerEntrySync({
            userId: targetUserId,
            asset,
            amount: -tx.amount,
            balanceBefore: prevAvailable,
            balanceAfter: prevAvailable,
            txType: 'SIMULATED_WITHDRAWAL',
            referenceId: tx.id,
            idempotencyKey: `wwdr-settle-${tx.id}`,
            description: `[WITHDRAWAL COMPLETED ${tx.referenceCode}] -${tx.amount} ${asset} settled by ${actor.email}`,
            createdAt: now,
          });
        } else {
          // REJECT withdrawal -> atomically refund reserved balance back to available balance!
          nextStatus = 'REJECTED';
          const nextReserved = this.roundAssetAmount(asset, Math.max(0, prevReserved - tx.amount));
          const nextAvailable = this.roundAssetAmount(asset, prevAvailable + tx.amount);
          this.db
            .prepare(
              `UPDATE wallet_asset_balances SET available_balance = ?, reserved_balance = ?, updated_at = ? WHERE user_id = ? AND asset = ?`
            )
            .run(nextAvailable, nextReserved, now, targetUserId, asset);

          if (asset === 'USDT') {
            const st =
              this.getUserTradingState(targetUserId)?.state ??
              createInitialEngineState({ startingBalance: 100_000, seedDemoPositions: false });
            const updatedState: TradingEngineState = {
              ...st,
              availableCash: nextAvailable,
              lastUpdated: now,
            };
            this.persistEngineStateSync(targetUserId, updatedState, now, false);
          }

          this.insertLedgerEntrySync({
            userId: targetUserId,
            asset,
            amount: tx.amount,
            balanceBefore: prevAvailable,
            balanceAfter: nextAvailable,
            txType: 'WALLET_WITHDRAWAL_RELEASE',
            referenceId: tx.id,
            idempotencyKey: `wwdr-refund-${tx.id}`,
            description: `[WITHDRAWAL REJECTED ${tx.referenceCode}] Released ${tx.amount} ${asset} back to available balance (${reason || 'Rejected by admin'})`,
            createdAt: now,
          });
        }
      }

      this.db
        .prepare(`
          UPDATE wallet_transactions
          SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          nextStatus,
          nextStatus === 'REJECTED' ? reason || 'Rejected by administrator.' : tx.rejectionReason,
          actor.email,
          now,
          now,
          tx.id
        );

      this.insertAuditLogSync({
        actorUserId,
        actorEmail: actor.email,
        action: 'ADMIN_WALLET_TX_REVIEWED',
        targetType: 'WALLET_TRANSACTION',
        targetId: tx.id,
        details: {
          referenceCode: tx.referenceCode,
          direction: tx.direction,
          asset: tx.asset,
          amount: tx.amount,
          previousStatus: tx.status,
          nextStatus,
          reason,
        },
        ipAddress: null,
        createdAt: now,
      });

      const updatedRow = this.db
        .prepare('SELECT w.*, u.email AS user_email FROM wallet_transactions w JOIN users u ON u.id = w.user_id WHERE w.id = ?')
        .get(tx.id) as Record<string, unknown>;
      return this.mapWalletTxRow(updatedRow);
    });
  }

  adminListSuspiciousAlerts(limit = 120): SuspiciousActivityAlertRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM suspicious_activity_alerts ORDER BY created_at DESC LIMIT ?')
      .all(Math.min(300, Math.max(1, limit))) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      userEmail: String(r.user_email),
      transactionId: r.transaction_id ? String(r.transaction_id) : null,
      severity: String(r.severity) as 'LOW' | 'MEDIUM' | 'HIGH',
      ruleCode: String(r.rule_code),
      description: String(r.description),
      status: String(r.status) as 'OPEN' | 'RESOLVED',
      resolvedBy: r.resolved_by ? String(r.resolved_by) : null,
      resolvedAt: r.resolved_at !== null ? Number(r.resolved_at) : null,
      createdAt: Number(r.created_at),
    }));
  }

  adminResolveSuspiciousAlert(actorUserId: string, alertId: string): SuspiciousActivityAlertRecord {
    return this.runInTransaction(() => {
      const actor = this.getPublicUserById(actorUserId);
      if (!actor || actor.role !== 'ADMIN') {
        throw new PermissionDeniedError('Admin privileges required.');
      }
      const existing = this.db
        .prepare('SELECT * FROM suspicious_activity_alerts WHERE id = ?')
        .get(alertId) as Record<string, unknown> | undefined;
      if (!existing) {
        throw new Error('Suspicious activity alert not found.');
      }
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE suspicious_activity_alerts SET status = 'RESOLVED', resolved_by = ?, resolved_at = ? WHERE id = ?`
        )
        .run(actor.email, now, alertId);

      this.insertAuditLogSync({
        actorUserId,
        actorEmail: actor.email,
        action: 'ADMIN_ALERT_RESOLVED',
        targetType: 'SUSPICIOUS_ALERT',
        targetId: alertId,
        details: { ruleCode: existing.rule_code, userEmail: existing.user_email },
        ipAddress: null,
        createdAt: now,
      });

      const updated = this.db
        .prepare('SELECT * FROM suspicious_activity_alerts WHERE id = ?')
        .get(alertId) as Record<string, unknown>;
      return {
        id: String(updated.id),
        userId: String(updated.user_id),
        userEmail: String(updated.user_email),
        transactionId: updated.transaction_id ? String(updated.transaction_id) : null,
        severity: String(updated.severity) as 'LOW' | 'MEDIUM' | 'HIGH',
        ruleCode: String(updated.rule_code),
        description: String(updated.description),
        status: String(updated.status) as 'OPEN' | 'RESOLVED',
        resolvedBy: updated.resolved_by ? String(updated.resolved_by) : null,
        resolvedAt: updated.resolved_at !== null ? Number(updated.resolved_at) : null,
        createdAt: Number(updated.created_at),
      };
    });
  }

  listAdminAuditLogs(limit = 120): AdminAuditLogRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?')
      .all(Math.min(500, Math.max(1, limit))) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
      actorEmail: String(r.actor_email),
      action: String(r.action),
      targetType: String(r.target_type),
      targetId: r.target_id ? String(r.target_id) : null,
      details: (() => {
        try {
          return JSON.parse(String(r.details_json)) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      createdAt: Number(r.created_at),
    }));
  }

  getDatabaseHealth(): {
    ok: boolean;
    driver: string;
    dbPath: string;
    tablesCount: number;
    usersCount: number;
    savedPortfoliosCount: number;
    ledgerTransactionsCount: number;
    serverTime: number;
  } {
    const tablesRow = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .get() as { cnt: number };
    const usersRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
    const snapRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM user_engine_snapshots')
      .get() as { cnt: number };
    const ledgerRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM ledger_transactions')
      .get() as { cnt: number };

    return {
      ok: true,
      driver: 'SQLite Relational Engine (node:sqlite WAL)',
      dbPath: 'data/tradeit.sqlite',
      tablesCount: Number(tablesRow.cnt),
      usersCount: Number(usersRow.cnt),
      savedPortfoliosCount: Number(snapRow.cnt),
      ledgerTransactionsCount: Number(ledgerRow.cnt),
      serverTime: Date.now(),
    };
  }
}

export const defaultStore = new PersistentStore();
