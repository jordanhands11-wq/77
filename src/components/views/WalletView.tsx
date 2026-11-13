import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Wallet as WalletIcon,
} from 'lucide-react';
import { computePerformanceMetrics } from '../../engine/risk.ts';
import type { NavSection, TradingEngineState } from '../../engine/types.ts';
import {
  apiCreateSimulatedDeposit,
  apiCreateSimulatedWithdrawal,
  apiGetWallet,
  type PublicPaymentProviderInfo,
  type UserWalletSummary,
  type WalletAsset,
  type WalletTransactionRecord,
} from '../../utils/api.ts';
import { formatAssetPrice, formatCurrency, formatDateTime } from '../../utils/format.ts';

export type WalletTabMode = 'OVERVIEW' | 'DEPOSIT' | 'WITHDRAW';

interface WalletViewProps {
  initialTab: WalletTabMode;
  state: TradingEngineState;
  isAuthenticated: boolean;
  onOpenAuthModal: (mode: 'LOGIN' | 'REGISTER') => void;
  onWalletStateSynced: (nextState: TradingEngineState) => void;
  onNavigate: (section: NavSection) => void;
}

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: 'text-[#37d69a] border-[#1b5547] bg-[#102b27]/70',
  APPROVED: 'text-[#6ea8fe] border-[#254478] bg-[#101c33]/80',
  PENDING: 'text-[#f2bd58] border-[#594b22] bg-[#211c0e]/80',
  REJECTED: 'text-[#ff667a] border-[#5d2331] bg-[#2c121a]/80',
};

function formatAssetQty(asset: WalletAsset, amount: number): string {
  if (asset === 'USDT') return formatCurrency(amount);
  const decimals = amount >= 100 ? 2 : amount >= 1 ? 4 : 6;
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  })} ${asset}`;
}

export const WalletView: React.FC<WalletViewProps> = ({
  initialTab,
  state,
  isAuthenticated,
  onOpenAuthModal,
  onWalletStateSynced,
  onNavigate,
}) => {
  const [tab, setTab] = useState<WalletTabMode>(initialTab);
  const [wallet, setWallet] = useState<UserWalletSummary | null>(null);
  const [providers, setProviders] = useState<PublicPaymentProviderInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Deposit Form State
  const [depAsset, setDepAsset] = useState<WalletAsset>('USDT');
  const [depProviderId, setDepProviderId] = useState<string>('sim_sandbox_rail');
  const [depAmount, setDepAmount] = useState<string>('2500');
  const [depNote, setDepNote] = useState<string>('');
  const [depForceReview, setDepForceReview] = useState<boolean>(false);
  const [depSubmitting, setDepSubmitting] = useState<boolean>(false);
  const [latestDepositTx, setLatestDepositTx] = useState<WalletTransactionRecord | null>(null);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  // Withdraw Form State
  const [wdAsset, setWdAsset] = useState<WalletAsset>('USDT');
  const [wdProviderId, setWdProviderId] = useState<string>('sim_sandbox_rail');
  const [wdAmount, setWdAmount] = useState<string>('1000');
  const [wdDestination, setWdDestination] = useState<string>('SIM-VAULT-SANDBOX-01');
  const [wdNote, setWdNote] = useState<string>('');
  const [wdConfirmed, setWdConfirmed] = useState<boolean>(false);
  const [wdForceReview, setWdForceReview] = useState<boolean>(false);
  const [wdSubmitting, setWdSubmitting] = useState<boolean>(false);
  const [latestWithdrawTx, setLatestWithdrawTx] = useState<WalletTransactionRecord | null>(null);

  // History Filters
  const [txDirFilter, setTxDirFilter] = useState<'ALL' | 'DEPOSIT' | 'WITHDRAWAL'>('ALL');
  const [txStatusFilter, setTxStatusFilter] = useState<string>('ALL');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const loadWallet = useCallback(async () => {
    if (!isAuthenticated) {
      setWallet(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetWallet();
      setWallet(res.wallet);
      setProviders(res.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load simulated wallet.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  // Keep deposit provider valid for selected asset
  useEffect(() => {
    const matching = providers.filter((p) => p.supportedAssets.includes(depAsset));
    if (matching.length > 0 && !matching.some((p) => p.id === depProviderId)) {
      setDepProviderId(matching[0].id);
    }
  }, [depAsset, depProviderId, providers]);

  // Keep withdrawal provider valid for selected asset
  useEffect(() => {
    const matching = providers.filter((p) => p.supportedAssets.includes(wdAsset));
    if (matching.length > 0 && !matching.some((p) => p.id === wdProviderId)) {
      setWdProviderId(matching[0].id);
    }
  }, [wdAsset, wdProviderId, providers]);

  const metrics = useMemo(() => computePerformanceMetrics(state), [state]);

  const selectedDepPrice = useMemo(() => {
    if (depAsset === 'USDT') return 1;
    return (
      state.markets[`${depAsset}USDT`]?.price ??
      wallet?.assets.find((a) => a.asset === depAsset)?.estimatedUsdPrice ??
      1
    );
  }, [depAsset, state.markets, wallet]);

  const selectedWdAssetRecord = useMemo(
    () => wallet?.assets.find((a) => a.asset === wdAsset) ?? null,
    [wallet, wdAsset]
  );

  const selectedWdPrice = useMemo(() => {
    if (wdAsset === 'USDT') return 1;
    return state.markets[`${wdAsset}USDT`]?.price ?? selectedWdAssetRecord?.estimatedUsdPrice ?? 1;
  }, [wdAsset, state.markets, selectedWdAssetRecord]);

  const cryptoHoldingsUsd = useMemo(() => {
    if (!wallet) return 0;
    return wallet.assets
      .filter((a) => a.asset !== 'USDT')
      .reduce((acc, a) => acc + a.estimatedUsdValue, 0);
  }, [wallet]);

  const filteredTransactions = useMemo(() => {
    if (!wallet) return [];
    return wallet.transactions.filter(
      (tx) =>
        (txDirFilter === 'ALL' || tx.direction === txDirFilter) &&
        (txStatusFilter === 'ALL' || tx.status === txStatusFilter)
    );
  }, [wallet, txDirFilter, txStatusFilter]);

  const copyReference = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRef(text);
      window.setTimeout(() => setCopiedRef(null), 1800);
    } catch {
      // Clipboard blocked in sandbox
    }
  };

  const handleSubmitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const amt = Number(depAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid positive simulated deposit amount.');
      return;
    }

    setDepSubmitting(true);
    try {
      const idempotencyKey = `ui-wdep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await apiCreateSimulatedDeposit({
        asset: depAsset,
        amount: amt,
        providerId: depProviderId,
        note: depNote.trim() || undefined,
        idempotencyKey,
        requestManualReview: depForceReview,
      });
      setWallet(res.wallet);
      setLatestDepositTx(res.transaction);
      onWalletStateSynced(res.state);
      setDepNote('');
      setNotice(
        res.transaction.status === 'COMPLETED'
          ? `Simulated deposit ${res.transaction.referenceCode} completed: +${formatAssetQty(depAsset, res.transaction.amount)} credited.`
          : `Simulated deposit ${res.transaction.referenceCode} queued as PENDING for administrator approval.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit simulated deposit.');
    } finally {
      setDepSubmitting(false);
    }
  };

  const handleSubmitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const amt = Number(wdAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid positive simulated withdrawal amount.');
      return;
    }
    if (!wdConfirmed) {
      setError('Please tick the confirmation box to submit a simulated withdrawal.');
      return;
    }

    setWdSubmitting(true);
    try {
      const idempotencyKey = `ui-wwdr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await apiCreateSimulatedWithdrawal({
        asset: wdAsset,
        amount: amt,
        destination: wdDestination.trim(),
        providerId: wdProviderId,
        confirmed: true,
        note: wdNote.trim() || undefined,
        idempotencyKey,
        requestManualReview: wdForceReview,
      });
      setWallet(res.wallet);
      setLatestWithdrawTx(res.transaction);
      onWalletStateSynced(res.state);
      setWdNote('');
      setWdConfirmed(false);
      setNotice(
        res.transaction.status === 'COMPLETED'
          ? `Simulated withdrawal ${res.transaction.referenceCode} completed: -${formatAssetQty(wdAsset, res.transaction.amount)}.`
          : `Simulated withdrawal ${res.transaction.referenceCode} submitted as PENDING (${formatAssetQty(wdAsset, res.transaction.amount)} locked in reserved balance to prevent double-spend).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit simulated withdrawal.');
    } finally {
      setWdSubmitting(false);
    }
  };

  const switchMode = (next: WalletTabMode) => {
    setTab(next);
    if (next === 'OVERVIEW') onNavigate('WALLET');
    if (next === 'DEPOSIT') onNavigate('DEPOSIT');
    if (next === 'WITHDRAW') onNavigate('WITHDRAW');
  };

  if (!isAuthenticated) {
    return (
      <div className="space-y-6">
        <section className="terminal-card p-6 border-[#594b22] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[#f3dc8d] text-xs font-bold uppercase tracking-wider">
              <Lock className="w-4 h-4" />
              Individual User Wallet Requires Authentication
            </div>
            <h2 className="text-base font-bold text-[#eef2f8]">
              Sign in to access your persistent SQLite paper wallet, simulated deposits, and withdrawals
            </h2>
            <p className="text-xs text-[#8190a8] max-w-2xl">
              Your guest trading desk currently holds{' '}
              <span className="font-mono text-[#eef2f8] font-semibold">
                {formatCurrency(metrics.availableCash)}
              </span>{' '}
              in local browser memory. Create or sign in to a trader account to provision a dedicated multi-asset wallet UID and immutable ledger history.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuthModal('LOGIN')}
              className="gold-button px-4 py-2.5 rounded-lg text-xs whitespace-nowrap"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onOpenAuthModal('REGISTER')}
              className="px-4 py-2.5 rounded-lg border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] text-xs font-semibold whitespace-nowrap"
            >
              Create Account
            </button>
          </div>
        </section>
      </div>
    );
  }

  const depUsdPreview = Number(((Number(depAmount) || 0) * selectedDepPrice).toFixed(2));
  const wdUsdPreview = Number(((Number(wdAmount) || 0) * selectedWdPrice).toFixed(2));
  const availableWdAmount = selectedWdAssetRecord?.availableBalance ?? 0;

  return (
    <div className="space-y-6">
      {/* Sandbox & Regulatory Boundary Banner */}
      <section className="terminal-card p-4 border-[#594b22] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <WalletIcon className="w-5 h-5 text-[#d4af37] shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-[#f3dc8d]">
                Simulated Paper Wallet &amp; Funding Infrastructure
              </h2>
              {wallet && (
                <span className="text-[11px] font-mono text-[#b8c4d7]">
                  UID: {wallet.walletUid} · {wallet.status}
                </span>
              )}
            </div>
            <p className="text-xs text-[#8190a8] mt-0.5">
              Simulated paper balances &amp; sandbox references only · Zero real money movement · Zero private keys generated
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadWallet()}
            className="px-3 py-1.5 rounded-lg border border-[#1b2940] text-xs font-semibold text-[#f3dc8d] hover:border-[#d4af37] inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Wallet
          </button>
        </div>
      </section>

      {/* Top Navigation Switcher within Wallet System */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => switchMode('OVERVIEW')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'OVERVIEW'
                ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                : 'bg-[#070c17] text-[#8190a8] border border-[#1b2940] hover:text-[#eef2f8]'
            }`}
          >
            <WalletIcon className="w-3.5 h-3.5" />
            My Wallet
          </button>
          <button
            type="button"
            onClick={() => switchMode('DEPOSIT')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'DEPOSIT'
                ? 'bg-[#102b27] text-[#37d69a] border border-[#1b5547]'
                : 'bg-[#070c17] text-[#8190a8] border border-[#1b2940] hover:text-[#eef2f8]'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            Deposit (Simulated)
          </button>
          <button
            type="button"
            onClick={() => switchMode('WITHDRAW')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'WITHDRAW'
                ? 'bg-[#2c121a] text-[#ff667a] border border-[#5d2331]'
                : 'bg-[#070c17] text-[#8190a8] border border-[#1b2940] hover:text-[#eef2f8]'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            Withdraw (Simulated)
          </button>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('PORTFOLIO')}
          className="text-xs text-[#d4af37] hover:underline whitespace-nowrap"
        >
          Open Portfolio Analytics →
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg p-3 border border-[#5d2331] bg-[#2c121a]/80 text-xs text-[#ff667a]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-lg p-3 border border-[#1b5547] bg-[#102b27]/70 text-xs text-[#37d69a]">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Wallet KPI Summary */}
      {wallet && (
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          <div className="terminal-card p-4 border-[#54451e]/80">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
              Total Portfolio Value
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#f3dc8d] mt-1.5">
              {formatCurrency(wallet.totalPortfolioUsdValue)}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">
              Wallet {formatCurrency(wallet.totalWalletUsdValue)} · Positions{' '}
              {formatCurrency(wallet.totalOpenPositionsUsdValue)}
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
              Available Settlement Cash (USDT)
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#37d69a] mt-1.5">
              {formatCurrency(wallet.availableUsdt)}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">
              Ready for orders &amp; simulated withdrawals
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
              Reserved Funds (Orders + Withdrawals)
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#f2bd58] mt-1.5">
              {formatCurrency(wallet.reservedUsdtForOrders + wallet.reservedUsdtForWithdrawals)}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">
              Orders: {formatCurrency(wallet.reservedUsdtForOrders)} · Withdrawals:{' '}
              {formatCurrency(wallet.reservedUsdtForWithdrawals)}
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
              Spot Crypto Wallet Holdings
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-[#eef2f8] mt-1.5">
              {formatCurrency(cryptoHoldingsUsd)}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">
              24h Withdrawal Used: {formatCurrency(wallet.dailyWithdrawalUsedUsd)} /{' '}
              {formatCurrency(wallet.dailyWithdrawalLimitUsd)}
            </div>
          </div>
        </section>
      )}

      {/* TAB: DEPOSIT INTERFACE */}
      {tab === 'DEPOSIT' && wallet && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form onSubmit={handleSubmitDeposit} className="lg:col-span-7 terminal-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1b2940] pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-[#eef2f8]">
                  Simulated Deposit Allocation
                </h3>
                <p className="text-xs text-[#8190a8]">
                  Generates a unique simulated reference code &amp; non-spendable sandbox instructions
                </p>
              </div>
              <span className="text-[10px] font-mono text-[#f2bd58] uppercase">
                Limit {formatCurrency(wallet.maxSingleDepositUsd)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[#8190a8] mb-1">Select Asset</label>
                <select
                  value={depAsset}
                  onChange={(e) => setDepAsset(e.target.value as WalletAsset)}
                  className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
                >
                  {wallet.assets.map((a) => (
                    <option key={a.asset} value={a.asset}>
                      {a.asset} (Avail: {formatAssetQty(a.asset, a.availableBalance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#8190a8] mb-1">Payment Rail / Adapter</label>
                <select
                  value={depProviderId}
                  onChange={(e) => setDepProviderId(e.target.value)}
                  className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8]"
                >
                  {providers
                    .filter((p) => p.supportedAssets.includes(depAsset))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="text-xs space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[#8190a8]">Simulated Amount ({depAsset})</label>
                <span className="font-mono text-[#f3dc8d] tabular-nums">
                  Est. Value: {formatCurrency(depUsdPreview)} (@ {formatAssetPrice(selectedDepPrice)})
                </span>
              </div>
              <input
                type="number"
                step="any"
                min={0.000001}
                required
                value={depAmount}
                onChange={(e) => setDepAmount(e.target.value)}
                className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-sm text-[#eef2f8]"
              />
              <div className="grid grid-cols-4 gap-2">
                {(depAsset === 'USDT' ? [1000, 5000, 10000, 25000] : [0.1, 0.5, 1, 5]).map(
                  (preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDepAmount(String(preset))}
                      className="py-1.5 rounded border border-[#1b2940] bg-[#070c17] text-[#b8c4d7] hover:border-[#d4af37] hover:text-[#f3dc8d] font-mono text-[11px]"
                    >
                      {depAsset === 'USDT' ? `+$${preset.toLocaleString('en-US')}` : `${preset} ${depAsset}`}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-[#8190a8] mb-1">Reference Note (Optional)</label>
              <input
                type="text"
                maxLength={120}
                value={depNote}
                onChange={(e) => setDepNote(e.target.value)}
                placeholder="e.g. Sandbox margin allocation"
                className="w-full min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 text-[#eef2f8]"
              />
            </div>

            <label className="flex items-start gap-2.5 text-xs text-[#b8c4d7] cursor-pointer">
              <input
                type="checkbox"
                checked={depForceReview}
                onChange={(e) => setDepForceReview(e.target.checked)}
                className="mt-0.5 accent-[#d4af37]"
              />
              <span>
                Queue as <strong className="text-[#f2bd58]">PENDING</strong> for manual Admin approval (auto-triggered above{' '}
                {formatCurrency(wallet.withdrawalApprovalThresholdUsd)})
              </span>
            </label>

            <button
              type="submit"
              disabled={depSubmitting}
              className="gold-button w-full min-h-[42px] rounded-lg text-xs inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {depSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Generate Reference &amp; Submit Simulated Deposit
            </button>
          </form>

          {/* Simulated Deposit Instructions Card */}
          <div className="lg:col-span-5 terminal-card p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#eef2f8] border-b border-[#1b2940] pb-2.5">
              Simulated Deposit Instructions
            </h3>

            {latestDepositTx?.instruction ? (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#8190a8]">Status</span>
                  <span
                    className={`px-2 py-0.5 rounded border font-mono text-[11px] font-semibold ${
                      STATUS_STYLE[latestDepositTx.status] ?? ''
                    }`}
                  >
                    {latestDepositTx.status}
                  </span>
                </div>

                <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8190a8]">Reference Code</span>
                    <button
                      type="button"
                      onClick={() => void copyReference(latestDepositTx.referenceCode)}
                      className="inline-flex items-center gap-1 font-mono font-bold text-[#f3dc8d] hover:underline"
                    >
                      {latestDepositTx.referenceCode}
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  {copiedRef === latestDepositTx.referenceCode && (
                    <div className="text-[10px] text-[#37d69a] text-right">Copied reference</div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#8190a8]">Sandbox Channel</span>
                    <span className="font-mono text-[#eef2f8]">
                      {latestDepositTx.instruction.networkOrChannel}
                    </span>
                  </div>

                  <div>
                    <div className="text-[#8190a8] mb-1">Simulated Destination Reference</div>
                    <div className="font-mono text-[11px] text-[#eef2f8] bg-[#0b1222] border border-[#1b2940] rounded px-2.5 py-2 break-all">
                      {latestDepositTx.instruction.simulatedDestination}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-[#594b22] bg-[#211c0e]/50 p-3 text-[11px] text-[#f3dc8d] leading-relaxed">
                  {latestDepositTx.instruction.disclaimer}
                </div>
              </div>
            ) : (
              <div className="py-10 text-center space-y-2 text-xs text-[#8190a8]">
                <p>
                  Submit a simulated deposit on the left to generate a unique reference code and sandbox instructions.
                </p>
                <p className="text-[11px] text-[#61708a]">
                  Duplicate submissions with the same idempotency key are blocked automatically (HTTP 409).
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB: WITHDRAW INTERFACE */}
      {tab === 'WITHDRAW' && wallet && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form onSubmit={handleSubmitWithdrawal} className="lg:col-span-7 terminal-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1b2940] pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-[#eef2f8]">
                  Simulated Withdrawal Request
                </h3>
                <p className="text-xs text-[#8190a8]">
                  Server-validated against available balance, reserved margin, and daily limits
                </p>
              </div>
              <span className="text-[10px] font-mono text-[#f2bd58] uppercase">
                24h Limit {formatCurrency(wallet.dailyWithdrawalLimitUsd)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[#8190a8] mb-1">Select Asset</label>
                <select
                  value={wdAsset}
                  onChange={(e) => setWdAsset(e.target.value as WalletAsset)}
                  className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
                >
                  {wallet.assets.map((a) => (
                    <option key={a.asset} value={a.asset}>
                      {a.asset} (Avail: {formatAssetQty(a.asset, a.availableBalance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#8190a8] mb-1">Withdrawal Rail</label>
                <select
                  value={wdProviderId}
                  onChange={(e) => setWdProviderId(e.target.value)}
                  className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8]"
                >
                  {providers
                    .filter((p) => p.supportedAssets.includes(wdAsset))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="text-xs space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[#8190a8]">
                  Withdrawal Amount ({wdAsset}) — Avail:{' '}
                  <strong className="text-[#eef2f8] font-mono">
                    {formatAssetQty(wdAsset, availableWdAmount)}
                  </strong>
                </label>
                <span className="font-mono text-[#f3dc8d] tabular-nums">
                  Est. USD: {formatCurrency(wdUsdPreview)}
                </span>
              </div>
              <input
                type="number"
                step="any"
                min={0.000001}
                required
                value={wdAmount}
                onChange={(e) => setWdAmount(e.target.value)}
                className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-sm text-[#eef2f8]"
              />
              <div className="grid grid-cols-4 gap-2">
                {[0.25, 0.5, 0.75, 1].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    disabled={availableWdAmount <= 0}
                    onClick={() => {
                      const val =
                        wdAsset === 'USDT'
                          ? Number((availableWdAmount * pct).toFixed(2))
                          : Number((availableWdAmount * pct).toFixed(6));
                      setWdAmount(String(val));
                    }}
                    className="py-1.5 rounded border border-[#1b2940] bg-[#070c17] text-[#b8c4d7] hover:border-[#d4af37] hover:text-[#f3dc8d] font-mono text-[11px] disabled:opacity-40"
                  >
                    {pct === 1 ? 'MAX' : `${pct * 100}%`}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[#8190a8] mb-1">
                  Simulated Destination Reference / Mock Address
                </label>
                <input
                  type="text"
                  required
                  maxLength={96}
                  value={wdDestination}
                  onChange={(e) => setWdDestination(e.target.value)}
                  placeholder="SIM-VAULT-SANDBOX-01"
                  className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
                />
              </div>

              <div>
                <label className="block text-[#8190a8] mb-1">Note (Optional)</label>
                <input
                  type="text"
                  maxLength={120}
                  value={wdNote}
                  onChange={(e) => setWdNote(e.target.value)}
                  placeholder="e.g. Simulated treasury sweep"
                  className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8]"
                />
              </div>
            </div>

            <div className="space-y-2 text-xs text-[#b8c4d7]">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wdForceReview}
                  onChange={(e) => setWdForceReview(e.target.checked)}
                  className="mt-0.5 accent-[#d4af37]"
                />
                <span>
                  Submit as <strong className="text-[#f2bd58]">PENDING</strong> (reserves funds immediately for Admin approval; auto-enabled at{' '}
                  {formatCurrency(wallet.withdrawalApprovalThresholdUsd)}+)
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer bg-[#070c17] border border-[#1b2940] rounded-lg p-3">
                <input
                  type="checkbox"
                  checked={wdConfirmed}
                  onChange={(e) => setWdConfirmed(e.target.checked)}
                  className="mt-0.5 accent-[#d4af37]"
                />
                <span>
                  I confirm this simulated withdrawal request for{' '}
                  <strong className="text-[#f3dc8d]">
                    {wdAmount || 0} {wdAsset}
                  </strong>{' '}
                  to <strong className="font-mono text-[#eef2f8]">{wdDestination || '—'}</strong> and understand no real funds are moved.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={wdSubmitting || !wdConfirmed}
              className="w-full min-h-[42px] rounded-lg border border-[#5d2331] bg-[#2c121a] text-[#ff667a] hover:brightness-110 font-bold text-xs inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {wdSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirm &amp; Submit Simulated Withdrawal
            </button>
          </form>

          {/* Withdrawal Security & Receipt Panel */}
          <div className="lg:col-span-5 terminal-card p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#eef2f8] border-b border-[#1b2940] pb-2.5">
              Security Limits &amp; Double-Spend Protection
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Single Withdrawal Limit</span>
                <span className="font-mono text-[#eef2f8]">
                  {formatCurrency(wallet.maxSingleWithdrawalUsd)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">24h Rolling Used / Limit</span>
                <span className="font-mono text-[#eef2f8]">
                  {formatCurrency(wallet.dailyWithdrawalUsedUsd)} /{' '}
                  {formatCurrency(wallet.dailyWithdrawalLimitUsd)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Admin Approval Threshold</span>
                <span className="font-mono text-[#f3dc8d]">
                  {formatCurrency(wallet.withdrawalApprovalThresholdUsd)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Reserved in Open Withdrawals</span>
                <span className="font-mono text-[#f2bd58]">
                  {formatAssetQty(wdAsset, selectedWdAssetRecord?.reservedBalance ?? 0)}
                </span>
              </div>
            </div>

            {latestWithdrawTx && (
              <div className="border-t border-[#1b2940] pt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#eef2f8]">Latest Withdrawal Receipt</span>
                  <span
                    className={`px-2 py-0.5 rounded border font-mono text-[11px] font-semibold ${
                      STATUS_STYLE[latestWithdrawTx.status] ?? ''
                    }`}
                  >
                    {latestWithdrawTx.status}
                  </span>
                </div>
                <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3 space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#8190a8]">Reference</span>
                    <span className="text-[#f3dc8d]">{latestWithdrawTx.referenceCode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8190a8]">Amount</span>
                    <span className="text-[#eef2f8]">
                      {formatAssetQty(latestWithdrawTx.asset, latestWithdrawTx.amount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8190a8]">Destination</span>
                    <span className="text-[#b8c4d7] truncate max-w-[180px]">
                      {latestWithdrawTx.destinationOrSource}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Supported Asset Balances Table (Visible across Wallet views) */}
      {wallet && (
        <section className="terminal-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-[#eef2f8]">
                Supported Wallet Asset Balances
              </h3>
              <p className="text-xs text-[#8190a8]">
                Individual simulated asset ledger balances synchronized with available trading cash
              </p>
            </div>
            <span className="text-xs font-mono text-[#d4af37] tabular-nums">
              Wallet Subtotal: {formatCurrency(wallet.totalWalletUsdValue)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Asset</th>
                  <th className="py-2.5 px-3 text-right">Available Balance</th>
                  <th className="py-2.5 px-3 text-right">Reserved Balance</th>
                  <th className="py-2.5 px-3 text-right">Total Balance</th>
                  <th className="py-2.5 px-3 text-right">Mark Price</th>
                  <th className="py-2.5 px-3 text-right">Est. USD Value</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2940]">
                {wallet.assets.map((row) => (
                  <tr key={row.asset} className="hover:bg-[#0e172a]/50">
                    <td className="py-2.5 px-3 font-bold text-[#f3dc8d]">
                      {row.asset}
                      {row.asset === 'USDT' && (
                        <span className="ml-1.5 text-[10px] font-normal text-[#8190a8]">
                          (Settlement Cash)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#eef2f8]">
                      {formatAssetQty(row.asset, row.availableBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#f2bd58]">
                      {formatAssetQty(row.asset, row.reservedBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#eef2f8]">
                      {formatAssetQty(row.asset, row.totalBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                      {formatAssetPrice(row.estimatedUsdPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#37d69a]">
                      {formatCurrency(row.estimatedUsdValue)}
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDepAsset(row.asset);
                          switchMode('DEPOSIT');
                        }}
                        className="px-2 py-1 rounded border border-[#1b5547] bg-[#102b27] text-[#37d69a] text-[11px] font-semibold"
                      >
                        Deposit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWdAsset(row.asset);
                          switchMode('WITHDRAW');
                        }}
                        className="px-2 py-1 rounded border border-[#5d2331] bg-[#2c121a] text-[#ff667a] text-[11px] font-semibold"
                      >
                        Withdraw
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Payment Infrastructure Adapters Panel */}
      {tab === 'OVERVIEW' && providers.length > 0 && (
        <section className="terminal-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-[#eef2f8]">
                Payment Infrastructure &amp; Provider Adapters
              </h3>
              <p className="text-xs text-[#8190a8]">
                Server-side adapter interfaces prepared for future regulated banking &amp; card rails (live processing locked off)
              </p>
            </div>
            <span className="text-[11px] font-mono text-[#ff667a] flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              LIVE PAYMENTS: DISABLED
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {providers.map((p) => {
              const Icon =
                p.railType === 'BANK_TRANSFER_SEPA_ACH'
                  ? Landmark
                  : p.railType === 'CARD_GATEWAY'
                    ? CreditCard
                    : WalletIcon;
              return (
                <div
                  key={p.id}
                  className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3.5 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#eef2f8] inline-flex items-center gap-1.5">
                      <Icon className="w-4 h-4 text-[#d4af37]" />
                      {p.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8190a8] leading-relaxed">{p.description}</p>
                  <div className="pt-1 border-t border-[#1b2940] flex items-center justify-between text-[11px] font-mono">
                    <span
                      className={
                        p.status === 'SIMULATED_SANDBOX_ONLY' ? 'text-[#37d69a]' : 'text-[#f2bd58]'
                      }
                    >
                      {p.status}
                    </span>
                    <span className="text-[#8190a8]">Assets: {p.supportedAssets.length}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Wallet Transaction History */}
      {wallet && (
        <section className="terminal-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-[#eef2f8]">
                Wallet Deposit &amp; Withdrawal History ({filteredTransactions.length})
              </h3>
              <p className="text-xs text-[#8190a8]">
                Immutable reference log synchronized with SQLite ledger_transactions
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                aria-label="Filter wallet direction"
                value={txDirFilter}
                onChange={(e) =>
                  setTxDirFilter(e.target.value as 'ALL' | 'DEPOSIT' | 'WITHDRAWAL')
                }
                className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-[#eef2f8]"
              >
                <option value="ALL">All Directions</option>
                <option value="DEPOSIT">Deposits</option>
                <option value="WITHDRAWAL">Withdrawals</option>
              </select>

              <select
                aria-label="Filter wallet status"
                value={txStatusFilter}
                onChange={(e) => setTxStatusFilter(e.target.value)}
                className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-[#eef2f8]"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#8190a8]">
              No simulated wallet deposits or withdrawals recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2.5 px-3">Reference</th>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Asset / Rail</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3 text-right">Est. USD</th>
                    <th className="py-2.5 px-3">Destination / Source</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2940]">
                  {filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3 font-mono font-bold text-[#f3dc8d]">
                        {tx.referenceCode}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#8190a8] tabular-nums">
                        {formatDateTime(tx.createdAt)}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono font-semibold ${
                          tx.direction === 'DEPOSIT' ? 'text-[#37d69a]' : 'text-[#ff667a]'
                        }`}
                      >
                        {tx.direction}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-[#eef2f8]">{tx.asset}</span>{' '}
                        <span className="text-[11px] text-[#8190a8]">· {tx.paymentRail}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        {tx.direction === 'DEPOSIT' ? '+' : '-'}
                        {formatAssetQty(tx.asset, tx.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#b8c4d7]">
                        {formatCurrency(tx.usdEquivalent)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#8190a8] max-w-[200px] truncate">
                        {tx.destinationOrSource}
                        {tx.rejectionReason && (
                          <div className="text-[10px] text-[#ff667a]">Reason: {tx.rejectionReason}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`px-2 py-0.5 rounded border font-mono text-[11px] font-semibold ${
                            STATUS_STYLE[tx.status] ?? 'text-[#b8c4d7] border-[#1b2940]'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
