import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Lock,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sliders,
  Users,
  Wallet as WalletIcon,
} from 'lucide-react';
import {
  apiAdminReviewWalletTransaction,
  apiAdminUpdateUser,
  apiGetAdminOverview,
  apiListAdminAuditLogs,
  apiListAdminOrders,
  apiListAdminSuspiciousAlerts,
  apiListAdminTransactions,
  apiListAdminUsers,
  apiListAdminWalletTransactions,
  apiResolveAdminSuspiciousAlert,
  apiUpdateAdminPair,
  apiUpdateAdminSettings,
  type AdminAuditLogRow,
  type AdminOrderRow,
  type AdminOverviewResponse,
  type AdminUserRow,
  type LedgerTransactionRecord,
  type PlatformSettingsRecord,
  type PublicUserProfile,
  type SuspiciousActivityAlertRecord,
  type WalletTransactionRecord,
} from '../../utils/api.ts';
import { formatAssetPrice, formatCurrency, formatDateTime } from '../../utils/format.ts';

interface AdminViewProps {
  currentUser: PublicUserProfile;
  onAdminWalletUpdated?: () => Promise<void> | void;
}

type AdminTab = 'CONTROLS' | 'WALLETS' | 'USERS' | 'MONITOR' | 'AUDIT';

export const AdminView: React.FC<AdminViewProps> = ({ currentUser, onAdminWalletUpdated }) => {
  const [tab, setTab] = useState<AdminTab>('CONTROLS');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [overviewData, setOverviewData] = useState<AdminOverviewResponse | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransactionRecord[]>([]);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransactionRecord[]>([]);
  const [suspiciousAlerts, setSuspiciousAlerts] = useState<SuspiciousActivityAlertRecord[]>([]);
  const [walletStatusFilter, setWalletStatusFilter] = useState<string>('ALL');
  const [rejectReasonByTx, setRejectReasonByTx] = useState<Record<string, string>>({});
  const [reviewingTxId, setReviewingTxId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRow[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<PlatformSettingsRecord | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, usr, ord, tx, wtx, alrt, aud] = await Promise.all([
        apiGetAdminOverview(),
        apiListAdminUsers(),
        apiListAdminOrders(120),
        apiListAdminTransactions(120),
        apiListAdminWalletTransactions(undefined, 150),
        apiListAdminSuspiciousAlerts(120),
        apiListAdminAuditLogs(120),
      ]);
      setOverviewData(ov);
      setSettingsDraft(ov.overview.settings);
      setUsers(usr.users);
      setOrders(ord.orders);
      setTransactions(tx.transactions);
      setWalletTransactions(wtx.transactions);
      setSuspiciousAlerts(alrt.alerts);
      setAuditLogs(aud.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load administration data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser.role === 'ADMIN') {
      void loadAll();
    }
  }, [currentUser.role, loadAll]);

  if (currentUser.role !== 'ADMIN') {
    return (
      <div className="terminal-card p-6 border-[#5d2331] text-center space-y-2">
        <Lock className="w-6 h-6 text-[#ff667a] mx-auto" />
        <h2 className="text-sm font-bold text-[#ff667a]">Administrator Access Denied</h2>
        <p className="text-xs text-[#8190a8]">
          Your account role ({currentUser.role}) does not have permission to view administrative records.
        </p>
      </div>
    );
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsDraft) return;
    setSavingSettings(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiUpdateAdminSettings({
        allowNewRegistrations: settingsDraft.allowNewRegistrations,
        tradingEnabled: settingsDraft.tradingEnabled,
        maxSimulatedDeposit: settingsDraft.maxSimulatedDeposit,
        maxSimulatedWithdrawal: settingsDraft.maxSimulatedWithdrawal,
        dailySimulatedWithdrawalLimit: settingsDraft.dailySimulatedWithdrawalLimit,
        withdrawalApprovalThreshold: settingsDraft.withdrawalApprovalThreshold,
        requireAdminApprovalForTransfers: settingsDraft.requireAdminApprovalForTransfers,
        maintenanceNotice: settingsDraft.maintenanceNotice,
      });
      setSettingsDraft(res.settings);
      setNotice('Platform & wallet governance settings saved and recorded in audit log.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save platform settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleReviewWalletTx = async (
    txId: string,
    decision: 'APPROVE' | 'COMPLETE' | 'REJECT'
  ) => {
    setError(null);
    setNotice(null);
    setReviewingTxId(txId);
    try {
      const reason = rejectReasonByTx[txId]?.trim() || undefined;
      const res = await apiAdminReviewWalletTransaction(txId, { decision, reason });
      setNotice(
        `Wallet transaction ${res.transaction.referenceCode} updated to ${res.transaction.status}.`
      );
      await loadAll();
      if (onAdminWalletUpdated) {
        await onAdminWalletUpdated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review wallet transaction.');
    } finally {
      setReviewingTxId(null);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    setError(null);
    setNotice(null);
    try {
      await apiResolveAdminSuspiciousAlert(alertId);
      setNotice('Suspicious activity alert marked RESOLVED and logged.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve alert.');
    }
  };

  const handleTogglePair = async (symbol: string, enabled: boolean) => {
    setError(null);
    setNotice(null);
    try {
      await apiUpdateAdminPair(symbol, { enabled });
      setNotice(`${symbol} ${enabled ? 'enabled' : 'disabled'} for simulated order routing.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update trading pair.');
    }
  };

  const handleUpdateUser = async (
    targetUserId: string,
    patch: { status?: 'ACTIVE' | 'SUSPENDED'; role?: 'TRADER' | 'ADMIN'; emailVerified?: boolean }
  ) => {
    setError(null);
    setNotice(null);
    try {
      await apiAdminUpdateUser(targetUserId, patch);
      setNotice('User account record updated.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user record.');
    }
  };

  const ov = overviewData?.overview;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="terminal-card p-4 border-[#594b22] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-[#d4af37]" />
          <div>
            <h2 className="text-sm font-bold text-[#f3dc8d]">
              77 TRADE IT Administration &amp; Governance Desk
            </h2>
            <p className="text-xs text-[#8190a8]">
              Authenticated Admin: {currentUser.email} · Server-enforced RBAC &amp; SQLite Audit Trail
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadAll()}
          className="px-3 py-1.5 rounded-lg border border-[#1b2940] text-xs font-semibold text-[#f3dc8d] hover:border-[#d4af37] inline-flex items-center gap-1.5 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Admin Desk
        </button>
      </section>

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

      {/* Overview KPIs */}
      {ov && (
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Accounts</div>
            <div className="text-xl font-bold font-mono text-[#eef2f8] mt-1.5 tabular-nums">
              {ov.usersTotal}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">
              {ov.activeUsers} Active · {ov.suspendedUsers} Suspended
            </div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Active Sessions</div>
            <div className="text-xl font-bold font-mono text-[#37d69a] mt-1.5 tabular-nums">
              {ov.activeSessions}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">{ov.adminUsers} Admin role(s)</div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Orders / Trades</div>
            <div className="text-xl font-bold font-mono text-[#f3dc8d] mt-1.5 tabular-nums">
              {ov.ordersTotal} / {ov.completedTradesTotal}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">Simulated paper executions</div>
          </div>

          <div className="terminal-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">Ledger Entries</div>
            <div className="text-xl font-bold font-mono text-[#eef2f8] mt-1.5 tabular-nums">
              {ov.ledgerTransactionsTotal}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">Immutable SQLite rows</div>
          </div>

          <div className="terminal-card p-4 col-span-2 lg:col-span-1">
            <div className="text-[11px] uppercase tracking-wider text-[#8190a8]">
              Platform Paper Cash
            </div>
            <div className="text-xl font-bold font-mono text-[#37d69a] mt-1.5 tabular-nums">
              {formatCurrency(ov.totalSimulatedPaperCash)}
            </div>
            <div className="text-[11px] text-[#8190a8] mt-1">Virtual capital total</div>
          </div>
        </section>
      )}

      {/* Admin Sub-Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[#1b2940] pb-3">
        {[
          { id: 'CONTROLS' as AdminTab, label: 'Platform Controls & Limits', icon: Sliders },
          {
            id: 'WALLETS' as AdminTab,
            label: `Wallet Review & Alerts (${walletTransactions.filter((t) => t.status === 'PENDING' || t.status === 'APPROVED').length} pending / ${suspiciousAlerts.filter((a) => a.status === 'OPEN').length} open alerts)`,
            icon: WalletIcon,
          },
          { id: 'USERS' as AdminTab, label: `Users (${users.length})`, icon: Users },
          {
            id: 'MONITOR' as AdminTab,
            label: `Orders & Ledger (${orders.length}/${transactions.length})`,
            icon: Activity,
          },
          { id: 'AUDIT' as AdminTab, label: `Audit Logs (${auditLogs.length})`, icon: ClipboardList },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
                active
                  ? 'bg-[#211c0e] text-[#f3dc8d] border border-[#594b22]'
                  : 'bg-[#070c17] text-[#8190a8] border border-[#1b2940] hover:text-[#eef2f8]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {loading && !overviewData ? (
        <div className="terminal-card p-8 flex items-center justify-center gap-2 text-xs text-[#8190a8]">
          <Loader2 className="w-4 h-4 animate-spin text-[#d4af37]" />
          Loading SQLite administrative records...
        </div>
      ) : null}

      {/* TAB 1: Platform Settings & Trading Pairs */}
      {tab === 'CONTROLS' && settingsDraft && overviewData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form onSubmit={handleSaveSettings} className="lg:col-span-5 terminal-card p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#eef2f8] border-b border-[#1b2940] pb-2.5">
              Platform Settings
            </h3>

            <div className="space-y-2.5 text-xs text-[#b8c4d7]">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsDraft.allowNewRegistrations}
                  onChange={(e) =>
                    setSettingsDraft({ ...settingsDraft, allowNewRegistrations: e.target.checked })
                  }
                  className="accent-[#d4af37]"
                />
                Allow new trader account registrations
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsDraft.tradingEnabled}
                  onChange={(e) =>
                    setSettingsDraft({ ...settingsDraft, tradingEnabled: e.target.checked })
                  }
                  className="accent-[#d4af37]"
                />
                Enable server-side simulated order execution
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsDraft.requireAdminApprovalForTransfers}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      requireAdminApprovalForTransfers: e.target.checked,
                    })
                  }
                  className="accent-[#d4af37]"
                />
                Require admin approval for ALL wallet deposits &amp; withdrawals
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[#8190a8] mb-1">Max Single Deposit (USD)</label>
                <input
                  type="number"
                  min={1000}
                  max={10000000}
                  step={1000}
                  value={settingsDraft.maxSimulatedDeposit}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      maxSimulatedDeposit: Number(e.target.value) || 250_000,
                    })
                  }
                  className="w-full min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 font-mono text-[#eef2f8]"
                />
              </div>

              <div>
                <label className="block text-[#8190a8] mb-1">Max Single Withdrawal (USD)</label>
                <input
                  type="number"
                  min={100}
                  max={10000000}
                  step={500}
                  value={settingsDraft.maxSimulatedWithdrawal}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      maxSimulatedWithdrawal: Number(e.target.value) || 100_000,
                    })
                  }
                  className="w-full min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 font-mono text-[#eef2f8]"
                />
              </div>

              <div>
                <label className="block text-[#8190a8] mb-1">24h Withdrawal Limit (USD)</label>
                <input
                  type="number"
                  min={500}
                  max={25000000}
                  step={1000}
                  value={settingsDraft.dailySimulatedWithdrawalLimit}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      dailySimulatedWithdrawalLimit: Number(e.target.value) || 250_000,
                    })
                  }
                  className="w-full min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 font-mono text-[#eef2f8]"
                />
              </div>

              <div>
                <label className="block text-[#8190a8] mb-1">Approval Threshold (USD)</label>
                <input
                  type="number"
                  min={0}
                  max={10000000}
                  step={500}
                  value={settingsDraft.withdrawalApprovalThreshold}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      withdrawalApprovalThreshold: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 font-mono text-[#eef2f8]"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-[#8190a8] mb-1">Maintenance Notice (Optional)</label>
              <input
                type="text"
                maxLength={180}
                value={settingsDraft.maintenanceNotice}
                onChange={(e) =>
                  setSettingsDraft({ ...settingsDraft, maintenanceNotice: e.target.value })
                }
                placeholder="e.g. Scheduled simulated feed calibration"
                className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8]"
              />
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="gold-button w-full min-h-[40px] rounded-lg text-xs inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {savingSettings && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Platform Settings
            </button>
          </form>

          <div className="lg:col-span-7 terminal-card p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#eef2f8] border-b border-[#1b2940] pb-2.5">
              Configured Trading Pairs ({overviewData.pairs.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2 px-2.5">Symbol</th>
                    <th className="py-2 px-2.5">Name</th>
                    <th className="py-2 px-2.5 text-right">Tick / Min Qty</th>
                    <th className="py-2 px-2.5 text-right">Maker / Taker Fee</th>
                    <th className="py-2 px-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2940]">
                  {overviewData.pairs.map((p) => (
                    <tr key={p.symbol} className="hover:bg-[#0e172a]/50">
                      <td className="py-2 px-2.5 font-mono font-bold text-[#f3dc8d]">{p.symbol}</td>
                      <td className="py-2 px-2.5 text-[#b8c4d7]">{p.name}</td>
                      <td className="py-2 px-2.5 text-right font-mono text-[#8190a8]">
                        {p.tickSize} / {p.minQty}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono text-[#8190a8]">
                        {(p.makerFeeRate * 100).toFixed(2)}% / {(p.takerFeeRate * 100).toFixed(2)}%
                      </td>
                      <td className="py-2 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void handleTogglePair(p.symbol, !p.enabled)}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold border ${
                            p.enabled
                              ? 'border-[#1b5547] bg-[#102b27] text-[#37d69a]'
                              : 'border-[#5d2331] bg-[#2c121a] text-[#ff667a]'
                          }`}
                        >
                          {p.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Wallet Review & Suspicious Activity Alerts */}
      {tab === 'WALLETS' && (
        <div className="space-y-4">
          <section className="terminal-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-[#eef2f8]">
                  Simulated Deposit &amp; Withdrawal Review Queue ({walletTransactions.length})
                </h3>
                <p className="text-xs text-[#8190a8]">
                  Approve, complete, or reject simulated wallet requests with atomic balance &amp; ledger settlement
                </p>
              </div>
              <select
                aria-label="Filter admin wallet transactions"
                value={walletStatusFilter}
                onChange={(e) => setWalletStatusFilter(e.target.value)}
                className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs text-[#eef2f8]"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </div>

            {walletTransactions.filter(
              (tx) => walletStatusFilter === 'ALL' || tx.status === walletStatusFilter
            ).length === 0 ? (
              <div className="py-6 text-center text-xs text-[#8190a8]">
                No wallet transactions match this filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                  <thead>
                    <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                      <th className="py-2 px-2.5">Reference</th>
                      <th className="py-2 px-2.5">Account / Wallet</th>
                      <th className="py-2 px-2.5">Direction / Asset</th>
                      <th className="py-2 px-2.5 text-right">Amount / Est. USD</th>
                      <th className="py-2 px-2.5">Status</th>
                      <th className="py-2 px-2.5 text-right">Admin Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1b2940]">
                    {walletTransactions
                      .filter(
                        (tx) => walletStatusFilter === 'ALL' || tx.status === walletStatusFilter
                      )
                      .map((tx) => {
                        const actionable = tx.status === 'PENDING' || tx.status === 'APPROVED';
                        const isBusy = reviewingTxId === tx.id;
                        return (
                          <tr key={tx.id} className="hover:bg-[#0e172a]/50">
                            <td className="py-2.5 px-2.5 font-mono">
                              <div className="font-bold text-[#f3dc8d]">{tx.referenceCode}</div>
                              <div className="text-[10px] text-[#8190a8]">
                                {formatDateTime(tx.createdAt)}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5">
                              <div className="text-[#eef2f8]">{tx.userEmail ?? tx.userId}</div>
                              <div className="text-[10px] font-mono text-[#8190a8]">
                                {tx.walletUid} · {tx.paymentRail}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 font-mono">
                              <span
                                className={
                                  tx.direction === 'DEPOSIT' ? 'text-[#37d69a]' : 'text-[#ff667a]'
                                }
                              >
                                {tx.direction}
                              </span>{' '}
                              · {tx.asset}
                              <div className="text-[10px] text-[#8190a8] max-w-[180px] truncate">
                                {tx.destinationOrSource}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                              <div className="font-semibold text-[#eef2f8]">
                                {tx.amount} {tx.asset}
                              </div>
                              <div className="text-[10px] text-[#8190a8]">
                                ~{formatCurrency(tx.usdEquivalent)}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 font-mono">
                              <span
                                className={
                                  tx.status === 'COMPLETED'
                                    ? 'text-[#37d69a] font-semibold'
                                    : tx.status === 'REJECTED'
                                      ? 'text-[#ff667a] font-semibold'
                                      : tx.status === 'APPROVED'
                                        ? 'text-[#6ea8fe] font-semibold'
                                        : 'text-[#f2bd58] font-semibold'
                                }
                              >
                                {tx.status}
                              </span>
                              {tx.reviewedBy && (
                                <div className="text-[10px] text-[#8190a8]">{tx.reviewedBy}</div>
                              )}
                            </td>
                            <td className="py-2.5 px-2.5 text-right">
                              {actionable ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    placeholder="Rejection reason"
                                    value={rejectReasonByTx[tx.id] ?? ''}
                                    onChange={(e) =>
                                      setRejectReasonByTx((prev) => ({
                                        ...prev,
                                        [tx.id]: e.target.value,
                                      }))
                                    }
                                    className="w-32 bg-[#070c17] border border-[#1b2940] rounded px-2 py-1 text-[11px] text-[#eef2f8]"
                                  />
                                  {tx.direction === 'WITHDRAWAL' && tx.status === 'PENDING' && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => void handleReviewWalletTx(tx.id, 'APPROVE')}
                                      className="px-2 py-1 rounded border border-[#254478] bg-[#101c33] text-[#6ea8fe] text-[11px] font-semibold disabled:opacity-50"
                                    >
                                      Approve
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => void handleReviewWalletTx(tx.id, 'COMPLETE')}
                                    className="px-2 py-1 rounded border border-[#1b5547] bg-[#102b27] text-[#37d69a] text-[11px] font-semibold disabled:opacity-50"
                                  >
                                    {tx.direction === 'DEPOSIT' ? 'Approve & Credit' : 'Complete'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => void handleReviewWalletTx(tx.id, 'REJECT')}
                                    className="px-2 py-1 rounded border border-[#5d2331] bg-[#2c121a] text-[#ff667a] text-[11px] font-semibold disabled:opacity-50"
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[11px] text-[#61708a] font-mono">
                                  Finalized
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Suspicious Activity Alerts */}
          <section className="terminal-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#1b2940] pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#f2bd58]" />
                <h3 className="text-sm font-bold text-[#eef2f8]">
                  Suspicious Activity &amp; Velocity Alerts ({suspiciousAlerts.length})
                </h3>
              </div>
              <span className="text-[11px] font-mono text-[#8190a8]">
                {suspiciousAlerts.filter((a) => a.status === 'OPEN').length} Open Alerts
              </span>
            </div>

            {suspiciousAlerts.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#8190a8]">
                No suspicious wallet activity alerts triggered yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                  <thead>
                    <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                      <th className="py-2 px-2.5">Timestamp</th>
                      <th className="py-2 px-2.5">Severity / Rule</th>
                      <th className="py-2 px-2.5">Account</th>
                      <th className="py-2 px-2.5">Description</th>
                      <th className="py-2 px-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1b2940]">
                    {suspiciousAlerts.map((al) => (
                      <tr key={al.id} className="hover:bg-[#0e172a]/50">
                        <td className="py-2 px-2.5 font-mono text-[#8190a8]">
                          {formatDateTime(al.createdAt)}
                        </td>
                        <td className="py-2 px-2.5 font-mono">
                          <span
                            className={
                              al.severity === 'HIGH'
                                ? 'text-[#ff667a] font-bold'
                                : al.severity === 'MEDIUM'
                                  ? 'text-[#f2bd58] font-semibold'
                                  : 'text-[#b8c4d7]'
                            }
                          >
                            {al.severity}
                          </span>{' '}
                          · {al.ruleCode}
                        </td>
                        <td className="py-2 px-2.5 text-[#eef2f8]">{al.userEmail}</td>
                        <td className="py-2 px-2.5 text-[#b8c4d7] max-w-[380px] truncate">
                          {al.description}
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {al.status === 'OPEN' ? (
                            <button
                              type="button"
                              onClick={() => void handleResolveAlert(al.id)}
                              className="px-2.5 py-1 rounded border border-[#1b5547] bg-[#102b27] text-[#37d69a] text-[11px] font-semibold"
                            >
                              Mark Resolved
                            </button>
                          ) : (
                            <span className="text-[11px] font-mono text-[#8190a8]">
                              RESOLVED ({al.resolvedBy})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: Users Management */}
      {tab === 'USERS' && (
        <section className="terminal-card p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Trader</th>
                  <th className="py-2.5 px-3">Role / Status</th>
                  <th className="py-2.5 px-3">Email</th>
                  <th className="py-2.5 px-3 text-right">Available / Reserved</th>
                  <th className="py-2.5 px-3 text-right">Open / Closed</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2940]">
                {users.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  return (
                    <tr key={u.id} className="hover:bg-[#0e172a]/50">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-[#eef2f8]">{u.displayName}</div>
                        <div className="text-[11px] text-[#8190a8]">
                          @{u.handle} · {u.email}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <span
                          className={
                            u.role === 'ADMIN' ? 'text-[#f3dc8d] font-bold' : 'text-[#b8c4d7]'
                          }
                        >
                          {u.role}
                        </span>{' '}
                        ·{' '}
                        <span
                          className={
                            u.status === 'ACTIVE' ? 'text-[#37d69a]' : 'text-[#ff667a] font-bold'
                          }
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={
                            u.emailVerified ? 'text-[#37d69a]' : 'text-[#f2bd58]'
                          }
                        >
                          {u.emailVerified ? 'Verified' : 'Unverified'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatCurrency(u.availableCash)} / {formatCurrency(u.reservedCash)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#8190a8]">
                        {u.openOrdersCount} / {u.completedTradesCount}
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1.5">
                        {!u.emailVerified && (
                          <button
                            type="button"
                            onClick={() => void handleUpdateUser(u.id, { emailVerified: true })}
                            className="px-2 py-1 rounded border border-[#1b5547] bg-[#102b27] text-[#37d69a] text-[11px]"
                          >
                            Verify
                          </button>
                        )}
                        {!isSelf && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateUser(u.id, {
                                  role: u.role === 'ADMIN' ? 'TRADER' : 'ADMIN',
                                })
                              }
                              className="px-2 py-1 rounded border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] text-[11px]"
                            >
                              {u.role === 'ADMIN' ? 'Set Trader' : 'Make Admin'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateUser(u.id, {
                                  status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                                })
                              }
                              className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                                u.status === 'ACTIVE'
                                  ? 'border-[#5d2331] bg-[#2c121a] text-[#ff667a]'
                                  : 'border-[#1b5547] bg-[#102b27] text-[#37d69a]'
                              }`}
                            >
                              {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: Platform Orders & Immutable Ledger */}
      {tab === 'MONITOR' && (
        <div className="space-y-4">
          <section className="terminal-card p-4 space-y-3">
            <h3 className="text-sm font-bold text-[#eef2f8]">Platform Order Monitor</h3>
            {orders.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#8190a8]">No persisted orders yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                  <thead>
                    <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                      <th className="py-2 px-2.5">Created</th>
                      <th className="py-2 px-2.5">Account</th>
                      <th className="py-2 px-2.5">Pair / Side</th>
                      <th className="py-2 px-2.5 text-right">Qty</th>
                      <th className="py-2 px-2.5 text-right">Price</th>
                      <th className="py-2 px-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1b2940]">
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className="py-2 px-2.5 font-mono text-[#8190a8]">
                          {formatDateTime(o.createdAt)}
                        </td>
                        <td className="py-2 px-2.5 text-[#eef2f8]">{o.userEmail}</td>
                        <td className="py-2 px-2.5 font-mono">
                          {o.symbol} · {o.side} ({o.orderType})
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono">{o.quantity}</td>
                        <td className="py-2 px-2.5 text-right font-mono">
                          {formatAssetPrice(o.executedPrice ?? o.requestedPrice)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-[#f3dc8d]">
                          {o.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="terminal-card p-4 space-y-3">
            <h3 className="text-sm font-bold text-[#eef2f8]">
              Immutable Ledger Transactions (All Accounts · Simulated Paper Only)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
                <thead>
                  <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                    <th className="py-2 px-2.5">Tx ID</th>
                    <th className="py-2 px-2.5">Timestamp</th>
                    <th className="py-2 px-2.5">Account</th>
                    <th className="py-2 px-2.5">Type / Asset</th>
                    <th className="py-2 px-2.5 text-right">Amount</th>
                    <th className="py-2 px-2.5 text-right">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2940]">
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-2 px-2.5 font-mono text-[#8190a8]">{tx.id.slice(0, 14)}…</td>
                      <td className="py-2 px-2.5 font-mono text-[#8190a8]">
                        {formatDateTime(tx.createdAt)}
                      </td>
                      <td className="py-2 px-2.5 text-[#eef2f8]">{tx.userEmail ?? tx.userId}</td>
                      <td className="py-2 px-2.5 font-mono text-[#f3dc8d]">
                        {tx.txType} · {tx.asset}
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-mono font-semibold ${
                          tx.amount >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                        }`}
                      >
                        {formatCurrency(tx.amount, true)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono text-[#eef2f8]">
                        {formatCurrency(tx.balanceAfter)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: Audit Logs */}
      {tab === 'AUDIT' && (
        <section className="terminal-card p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Actor</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Target</th>
                  <th className="py-2.5 px-3">IP / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2940]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#0e172a]/50">
                    <td className="py-2.5 px-3 font-mono text-[#8190a8]">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2.5 px-3 text-[#eef2f8]">{log.actorEmail}</td>
                    <td
                      className={`py-2.5 px-3 font-mono font-semibold ${
                        log.action === 'UNAUTHORIZED_ADMIN_ACCESS'
                          ? 'text-[#ff667a]'
                          : 'text-[#f3dc8d]'
                      }`}
                    >
                      {log.action}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#8190a8]">
                      {log.targetType}
                      {log.targetId ? ` (${log.targetId.slice(0, 18)})` : ''}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#b8c4d7]">
                      {log.ipAddress ? `${log.ipAddress} · ` : ''}
                      {JSON.stringify(log.details).slice(0, 80)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
