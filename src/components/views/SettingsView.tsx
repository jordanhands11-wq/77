import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Loader2,
  Lock,
  LogOut,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  FUTURE_EXCHANGE_CONNECTORS,
  getLiveExecutionGuardStatus,
} from '../../engine/exchangeArchitecture.ts';
import type {
  MarketDataMode,
  MarketFeedStatus,
  NavSection,
  RiskSettings,
  TradingEngineState,
} from '../../engine/types.ts';
import {
  apiGetHealth,
  apiRequestEmailVerification,
  apiVerifyEmail,
  type DatabaseHealthResponse,
  type PublicUserProfile,
} from '../../utils/api.ts';
import { formatCurrency, formatDateTime } from '../../utils/format.ts';

interface SettingsViewProps {
  state: TradingEngineState;
  currentUser: PublicUserProfile | null;
  lastServerSyncAt: number | null;
  serverSyncError: string | null;
  feedStatus: MarketFeedStatus;
  feedProviderName: string;
  lastFeedUpdatedAt: number | null;
  feedError: string | null;
  onOpenAuthModal: (mode: 'LOGIN' | 'REGISTER') => void;
  onLogout: () => Promise<void>;
  onUpdateProfile: (patch: {
    displayName?: string;
    handle?: string;
    baseCurrency?: 'USD' | 'EUR' | 'GBP';
    bio?: string;
    timezone?: string;
  }) => Promise<void>;
  onUserProfileUpdated?: (user: PublicUserProfile) => void;
  onNavigate?: (section: NavSection) => void;
  onUpdateRisk: (patch: Partial<RiskSettings>) => void;
  onResetAccount: (startingBalance: number) => Promise<void>;
  onMarketDataModeChange: (mode: MarketDataMode) => void;
  onFetchLivePublicQuotes: () => Promise<boolean>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  state,
  currentUser,
  lastServerSyncAt,
  serverSyncError,
  feedStatus,
  feedProviderName,
  lastFeedUpdatedAt,
  feedError,
  onOpenAuthModal,
  onLogout,
  onUpdateProfile,
  onUserProfileUpdated,
  onNavigate,
  onUpdateRisk,
  onResetAccount,
  onMarketDataModeChange,
  onFetchLivePublicQuotes,
}) => {
  const [riskDraft, setRiskDraft] = useState<RiskSettings>(state.riskSettings);
  const [savedNotice, setSavedNotice] = useState(false);
  const [resetAmount, setResetAmount] = useState<number>(100_000);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [isFetchingQuotes, setIsFetchingQuotes] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(currentUser?.displayName ?? '');
  const [handle, setHandle] = useState(currentUser?.handle ?? '');
  const [baseCurrency, setBaseCurrency] = useState<'USD' | 'EUR' | 'GBP'>(
    currentUser?.baseCurrency ?? 'USD'
  );
  const [bio, setBio] = useState(currentUser?.bio ?? '');
  const [timezone, setTimezone] = useState(currentUser?.timezone ?? 'UTC');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // Email verification state
  const [verifyTokenInput, setVerifyTokenInput] = useState('');
  const [verifyPreviewToken, setVerifyPreviewToken] = useState<string | null>(null);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [dbHealth, setDbHealth] = useState<DatabaseHealthResponse | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);

  useEffect(() => {
    setRiskDraft(state.riskSettings);
  }, [state.riskSettings]);

  useEffect(() => {
    setDisplayName(currentUser?.displayName ?? '');
    setHandle(currentUser?.handle ?? '');
    setBaseCurrency(currentUser?.baseCurrency ?? 'USD');
    setBio(currentUser?.bio ?? '');
    setTimezone(currentUser?.timezone ?? 'UTC');
    setProfileFeedback(null);
    setVerifyFeedback(null);
  }, [currentUser]);

  const checkDbHealth = async () => {
    setCheckingDb(true);
    setDbError(null);
    try {
      const health = await apiGetHealth();
      setDbHealth(health);
    } catch (err) {
      setDbError(err instanceof Error ? err.message : 'Unable to reach persistence server.');
    } finally {
      setCheckingDb(false);
    }
  };

  useEffect(() => {
    void checkDbHealth();
  }, [currentUser?.id]);

  const liveGuard = getLiveExecutionGuardStatus();

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileFeedback(null);
    setSavingProfile(true);
    try {
      await onUpdateProfile({ displayName, handle, baseCurrency, bio, timezone });
      setProfileFeedback({ ok: true, text: 'Profile updated and persisted to SQLite database.' });
    } catch (err) {
      setProfileFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to save profile.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRequestVerification = async () => {
    setVerifyFeedback(null);
    setVerifyingEmail(true);
    try {
      const res = await apiRequestEmailVerification();
      if (res.previewToken) {
        setVerifyPreviewToken(res.previewToken);
        setVerifyTokenInput(res.previewToken);
        setVerifyFeedback({
          ok: true,
          text: 'Verification token generated (Local Dev Preview — SMTP not configured). Click Confirm Verify below.',
        });
      } else {
        setVerifyFeedback({ ok: true, text: 'Verification email dispatched via SMTP.' });
      }
    } catch (err) {
      setVerifyFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to issue verification token.',
      });
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleConfirmVerifyEmail = async () => {
    if (!verifyTokenInput.trim()) return;
    setVerifyFeedback(null);
    setVerifyingEmail(true);
    try {
      const res = await apiVerifyEmail(verifyTokenInput.trim());
      setVerifyPreviewToken(null);
      setVerifyTokenInput('');
      setVerifyFeedback({ ok: true, text: 'Email address verified and persisted.' });
      onUserProfileUpdated?.(res.user);
    } catch (err) {
      setVerifyFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Verification failed.',
      });
    } finally {
      setVerifyingEmail(false);
    }
  };

  const handleSaveRisk = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateRisk(riskDraft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleTestLiveQuotes = async () => {
    setIsFetchingQuotes(true);
    setQuoteStatus('Fetching read-only public 24h market tickers and OHLCV candles...');
    try {
      const ok = await onFetchLivePublicQuotes();
      setQuoteStatus(
        ok
          ? 'Updated spot prices, 24h volume/change, and historical OHLCV from free public feeds (Paper execution remains strictly simulated).'
          : 'Public market feed unreachable — simulated data is NOT presented as live.'
      );
    } finally {
      setIsFetchingQuotes(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Trader Account, Profile & Database Persistence */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 terminal-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#d4af37]" />
              <div>
                <h2 className="text-sm font-bold text-[#eef2f8]">
                  Trader Account &amp; Profile Settings
                </h2>
                <p className="text-xs text-[#8190a8]">
                  {currentUser
                    ? `Signed in as ${currentUser.email} · Role: ${currentUser.role}`
                    : 'Guest Paper Session (Browser Cache Only)'}
                </p>
              </div>
            </div>
            {currentUser && (
              <div className="flex items-center gap-2">
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                    currentUser.emailVerified
                      ? 'border-[#1b5547] bg-[#102b27] text-[#37d69a]'
                      : 'border-[#5c4a22] bg-[#2a2110] text-[#f2bd58]'
                  }`}
                >
                  {currentUser.emailVerified ? 'EMAIL VERIFIED' : 'UNVERIFIED EMAIL'}
                </span>
                <span className="text-[11px] font-mono text-[#37d69a]">
                  {lastServerSyncAt
                    ? `Synced ${formatDateTime(lastServerSyncAt)}`
                    : 'Sync Active'}
                </span>
              </div>
            )}
          </div>

          {currentUser ? (
            <div className="space-y-4">
              <form onSubmit={handleSaveProfile} className="space-y-3.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#8190a8] mb-1">Display Name</label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={48}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[#8190a8] mb-1">Trader Handle</label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={24}
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[#8190a8] mb-1">Registered Email</label>
                    <input
                      type="email"
                      disabled
                      value={currentUser.email}
                      className="w-full min-h-[40px] bg-[#070c17]/60 border border-[#1b2940] rounded-lg px-3 py-2 text-[#8190a8] cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-[#8190a8] mb-1">Reporting Preference</label>
                    <select
                      value={baseCurrency}
                      onChange={(e) => setBaseCurrency(e.target.value as 'USD' | 'EUR' | 'GBP')}
                      className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#f3dc8d]"
                    >
                      <option value="USD">USD (USDT Quote Desk)</option>
                      <option value="EUR">EUR (Profile Preference)</option>
                      <option value="GBP">GBP (Profile Preference)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#8190a8] mb-1">Desk Bio</label>
                    <input
                      type="text"
                      maxLength={180}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="e.g. Momentum & confluence trader"
                      className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>
                  <div>
                    <label className="block text-[#8190a8] mb-1">Timezone</label>
                    <input
                      type="text"
                      maxLength={48}
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="UTC"
                      className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
                    />
                  </div>
                </div>

                {profileFeedback && (
                  <div
                    className={`flex items-center gap-2 rounded-lg p-2.5 border text-xs ${
                      profileFeedback.ok
                        ? 'bg-[#102b27]/70 border-[#1b5547] text-[#37d69a]'
                        : 'bg-[#2c121a]/80 border-[#5d2331] text-[#ff667a]'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{profileFeedback.text}</span>
                  </div>
                )}

                {serverSyncError && (
                  <div className="rounded-lg p-2.5 border border-[#5d2331] bg-[#2c121a]/80 text-[#ff667a] text-xs">
                    Sync warning: {serverSyncError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="gold-button min-h-[40px] px-4 py-2 rounded-lg text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
                    >
                      {savingProfile && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {savingProfile ? 'Saving Profile...' : 'Save Profile'}
                    </button>
                    {currentUser.role === 'ADMIN' && onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('ADMIN')}
                        className="min-h-[40px] px-3.5 py-2 rounded-lg border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] text-xs font-semibold"
                      >
                        Open Admin Desk
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className="min-h-[40px] px-3.5 py-2 rounded-lg border border-[#1b2940] text-xs font-semibold text-[#b8c4d7] hover:text-[#ff667a] hover:border-[#5d2331] inline-flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              </form>

              {/* Email Verification Section */}
              {!currentUser.emailVerified && (
                <div className="border-t border-[#1b2940] pt-3.5 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-[#f3dc8d]">Email Verification Required</div>
                      <div className="text-[11px] text-[#8190a8]">
                        Verify your address with a single-use SHA-256 verification token.
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={verifyingEmail}
                      onClick={() => void handleRequestVerification()}
                      className="px-3 py-1.5 rounded-lg border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] font-semibold disabled:opacity-60"
                    >
                      Issue Verification Token
                    </button>
                  </div>

                  {verifyPreviewToken && (
                    <div className="bg-[#211c0e] border border-[#594b22] rounded-lg p-2 font-mono text-[11px] text-[#f3dc8d] break-all">
                      Dev Preview Token: {verifyPreviewToken}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={verifyTokenInput}
                      onChange={(e) => setVerifyTokenInput(e.target.value)}
                      placeholder="Paste verification token"
                      className="flex-1 min-w-[180px] min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-1.5 font-mono text-[#eef2f8]"
                    />
                    <button
                      type="button"
                      disabled={verifyingEmail || !verifyTokenInput.trim()}
                      onClick={() => void handleConfirmVerifyEmail()}
                      className="gold-button min-h-[38px] px-4 rounded-lg text-xs disabled:opacity-50"
                    >
                      Confirm Verify
                    </button>
                  </div>

                  {verifyFeedback && (
                    <div
                      className={`rounded-lg p-2 border text-xs ${
                        verifyFeedback.ok
                          ? 'bg-[#102b27]/70 border-[#1b5547] text-[#37d69a]'
                          : 'bg-[#2c121a]/80 border-[#5d2331] text-[#ff667a]'
                      }`}
                    >
                      {verifyFeedback.text}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <p className="text-[#b8c4d7] leading-relaxed bg-[#070c17] border border-[#1b2940] rounded-lg p-3">
                You are currently running in local Guest Paper mode. Create an account or sign in to
                persist your simulated portfolio, open positions, ledger history, and risk settings
                to the SQLite relational database.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenAuthModal('LOGIN')}
                  className="gold-button min-h-[42px] px-4 py-2 rounded-lg text-xs inline-flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuthModal('REGISTER')}
                  className="min-h-[42px] px-4 py-2 rounded-lg border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Create Trader Account
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Server Database Connection Status */}
        <div className="lg:col-span-5 terminal-card p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2 border-b border-[#1b2940] pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#d4af37]" />
              <div>
                <h2 className="text-sm font-bold text-[#eef2f8]">Database &amp; Persistence</h2>
                <p className="text-xs text-[#8190a8]">SQLite WAL relational storage verification</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void checkDbHealth()}
              disabled={checkingDb}
              className="px-2.5 py-1.5 rounded-lg border border-[#1b2940] text-[11px] font-semibold text-[#b8c4d7] hover:text-[#f3dc8d] inline-flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${checkingDb ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {dbError ? (
            <div className="text-xs text-[#ff667a] bg-[#2c121a]/80 border border-[#5d2331] rounded-lg p-3">
              {dbError}
            </div>
          ) : dbHealth ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Connection</span>
                <span className="font-semibold text-[#37d69a]">
                  {dbHealth.ok ? 'Connected' : 'Offline'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#8190a8]">Storage Engine</span>
                <span className="font-mono text-[#eef2f8] text-right">{dbHealth.driver}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Relational Tables</span>
                <span className="font-mono text-[#f3dc8d] tabular-nums">
                  {dbHealth.tablesCount} tables
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Registered Accounts</span>
                <span className="font-mono text-[#eef2f8] tabular-nums">
                  {dbHealth.usersCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Persisted Portfolios</span>
                <span className="font-mono text-[#eef2f8] tabular-nums">
                  {dbHealth.savedPortfoliosCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Ledger Records</span>
                <span className="font-mono text-[#eef2f8] tabular-nums">
                  {dbHealth.ledgerTransactionsCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Email Delivery</span>
                <span className="font-mono text-[#b8c4d7]">
                  {dbHealth.smtpConfigured ? 'SMTP Active' : 'Local Dev Preview (No SMTP)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8190a8]">Execution Guard</span>
                <span className="font-mono text-[#f2bd58]">{dbHealth.mode}</span>
              </div>
            </div>
          ) : (
            <div className="py-4 text-xs text-[#8190a8] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#d4af37]" />
              Checking database status...
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Risk Management Settings */}
        <form onSubmit={handleSaveRisk} className="lg:col-span-7 terminal-card p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1b2940] pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#d4af37]" />
              <div>
                <h2 className="text-sm font-bold text-[#eef2f8]">
                  Risk Controls &amp; Paper Execution Rules
                </h2>
                <p className="text-xs text-[#8190a8]">Enforced prior to every simulated order</p>
              </div>
            </div>
            {savedNotice && <span className="text-xs font-semibold text-[#37d69a]">Saved</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
            <div>
              <label className="block text-[#8190a8] mb-1">Max Risk Per Trade (%)</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                max="10"
                value={riskDraft.maxRiskPerTradePct}
                onChange={(e) =>
                  setRiskDraft({ ...riskDraft, maxRiskPerTradePct: Number(e.target.value) || 2 })
                }
                className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>

            <div>
              <label className="block text-[#8190a8] mb-1">Max Open Positions</label>
              <input
                type="number"
                min="1"
                max="20"
                value={riskDraft.maxOpenPositions}
                onChange={(e) =>
                  setRiskDraft({
                    ...riskDraft,
                    maxOpenPositions: Math.max(1, Number(e.target.value) || 6),
                  })
                }
                className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>

            <div>
              <label className="block text-[#8190a8] mb-1">Daily Loss Limit (%)</label>
              <input
                type="number"
                step="0.5"
                min="1"
                max="25"
                value={riskDraft.dailyLossLimitPct}
                onChange={(e) =>
                  setRiskDraft({ ...riskDraft, dailyLossLimitPct: Number(e.target.value) || 5 })
                }
                className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>

            <div>
              <label className="block text-[#8190a8] mb-1">Max Portfolio Exposure (%)</label>
              <input
                type="number"
                step="5"
                min="10"
                max="100"
                value={riskDraft.maxPortfolioExposurePct}
                onChange={(e) =>
                  setRiskDraft({
                    ...riskDraft,
                    maxPortfolioExposurePct: Number(e.target.value) || 85,
                  })
                }
                className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>

            <div>
              <label className="block text-[#8190a8] mb-1">Default Stop-Loss (%)</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                max="25"
                value={riskDraft.defaultStopLossPct}
                onChange={(e) =>
                  setRiskDraft({ ...riskDraft, defaultStopLossPct: Number(e.target.value) || 2 })
                }
                className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>

            <div>
              <label className="block text-[#8190a8] mb-1">Default Take-Profit (%)</label>
              <input
                type="number"
                step="0.25"
                min="0.5"
                max="50"
                value={riskDraft.defaultTakeProfitPct}
                onChange={(e) =>
                  setRiskDraft({ ...riskDraft, defaultTakeProfitPct: Number(e.target.value) || 4.5 })
                }
                className="w-full min-h-[40px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-1 text-xs text-[#b8c4d7]">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={riskDraft.enforceRiskLimits}
                onChange={(e) =>
                  setRiskDraft({ ...riskDraft, enforceRiskLimits: e.target.checked })
                }
                className="accent-[#d4af37]"
              />
              Block orders that exceed Max Risk Per Trade or Max Portfolio Exposure limits
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={riskDraft.requireStopLoss}
                onChange={(e) =>
                  setRiskDraft({ ...riskDraft, requireStopLoss: e.target.checked })
                }
                className="accent-[#d4af37]"
              />
              Require an explicit Stop-Loss price on all opening orders
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={riskDraft.requireConfirmation}
                onChange={(e) =>
                  setRiskDraft({ ...riskDraft, requireConfirmation: e.target.checked })
                }
                className="accent-[#d4af37]"
              />
              Require second-step order confirmation before executing simulated trades
            </label>
          </div>

          <button type="submit" className="gold-button min-h-[40px] px-4 py-2 rounded-lg text-xs">
            Save Risk Configuration
          </button>
        </form>

        {/* Paper Account Capital Reset + Market Data Source */}
        <div className="lg:col-span-5 space-y-4">
          <div className="terminal-card p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-[#1b2940] pb-3">
              <Radio className="w-4 h-4 text-[#d4af37]" />
              <div>
                <h2 className="text-sm font-bold text-[#eef2f8]">Market Data Provider</h2>
                <p className="text-xs text-[#8190a8]">
                  Clearly separates simulated quotes from read-only public spot prices
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => onMarketDataModeChange('SIMULATED')}
                className={`min-h-[40px] py-2 px-3 rounded-lg border font-semibold ${
                  state.marketDataMode === 'SIMULATED'
                    ? 'bg-[#211c0e] border-[#d4af37] text-[#f3dc8d]'
                    : 'bg-[#070c17] border-[#1b2940] text-[#8190a8]'
                }`}
              >
                Simulated Engine
              </button>
              <button
                type="button"
                onClick={() => onMarketDataModeChange('LIVE_PUBLIC_READONLY')}
                className={`min-h-[40px] py-2 px-3 rounded-lg border font-semibold ${
                  state.marketDataMode === 'LIVE_PUBLIC_READONLY'
                    ? 'bg-[#102b27] border-[#1b5547] text-[#37d69a]'
                    : 'bg-[#070c17] border-[#1b2940] text-[#8190a8]'
                }`}
              >
                Public Spot (Read-Only)
              </button>
            </div>

            <button
              type="button"
              disabled={isFetchingQuotes}
              onClick={handleTestLiveQuotes}
              className="w-full min-h-[40px] py-2 rounded-lg border border-[#1b2940] text-xs font-semibold text-[#f3dc8d] hover:border-[#d4af37] inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isFetchingQuotes && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isFetchingQuotes ? 'Syncing Live Market Snapshot...' : 'Pull Live Market Snapshot'}
            </button>

            <div className="text-[11px] text-[#8190a8] bg-[#070c17] border border-[#1b2940] rounded-lg p-2.5 space-y-1">
              <div className="flex justify-between">
                <span>Connection Status</span>
                <span className="font-mono font-semibold text-[#eef2f8]">{feedStatus}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Provider</span>
                <span className="font-mono text-[#b8c4d7] text-right">{feedProviderName}</span>
              </div>
              {lastFeedUpdatedAt && (
                <div className="flex justify-between">
                  <span>Last Sync</span>
                  <span className="font-mono text-[#b8c4d7]">{formatDateTime(lastFeedUpdatedAt)}</span>
                </div>
              )}
              {feedError && <div className="text-[#ff667a] pt-1">{feedError}</div>}
            </div>

            {quoteStatus && (
              <div className="text-[11px] text-[#b8c4d7] bg-[#070c17] border border-[#1b2940] rounded-lg p-2.5">
                {quoteStatus}
              </div>
            )}
          </div>

          <div className="terminal-card p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-[#1b2940] pb-3">
              <RefreshCw className="w-4 h-4 text-[#d4af37]" />
              <div>
                <h2 className="text-sm font-bold text-[#eef2f8]">Paper Account Reset</h2>
                <p className="text-xs text-[#8190a8]">
                  Reset virtual balance, positions, and order history
                </p>
              </div>
            </div>

            <div className="text-xs text-[#b8c4d7] space-y-1">
              <div>
                Current Starting Capital:{' '}
                <strong className="font-mono text-[#eef2f8]">
                  {formatCurrency(state.startingBalance)}
                </strong>
              </div>
              <div>
                Current Available Cash:{' '}
                <strong className="font-mono text-[#37d69a]">
                  {formatCurrency(state.availableCash)}
                </strong>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#8190a8] mb-1.5">
                Select Virtual Starting Balance
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[10_000, 50_000, 100_000, 250_000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setResetAmount(amt)}
                    className={`min-h-[38px] py-2 rounded-lg border text-xs font-mono font-semibold ${
                      resetAmount === amt
                        ? 'bg-[#211c0e] border-[#d4af37] text-[#f3dc8d]'
                        : 'bg-[#070c17] border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
                    }`}
                  >
                    ${(amt / 1000).toFixed(0)}K
                  </button>
                ))}
              </div>
            </div>

            {confirmReset ? (
              <div className="space-y-2">
                <div className="text-xs text-[#f2bd58] bg-[#2a2110] border border-[#5c4a22] rounded-lg p-2.5">
                  Confirm resetting paper account to {formatCurrency(resetAmount)}? All simulated
                  positions and trades will be cleared.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isResetting}
                    onClick={() => setConfirmReset(false)}
                    className="min-h-[40px] py-2 rounded-lg border border-[#1b2940] text-xs text-[#b8c4d7]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isResetting}
                    onClick={async () => {
                      setIsResetting(true);
                      try {
                        await onResetAccount(resetAmount);
                        setConfirmReset(false);
                      } finally {
                        setIsResetting(false);
                      }
                    }}
                    className="min-h-[40px] py-2 rounded-lg bg-[#2c121a] border border-[#5d2331] text-[#ff667a] text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    {isResetting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Confirm Reset
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="w-full min-h-[42px] py-2.5 rounded-lg border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] hover:brightness-110 text-xs font-bold"
              >
                Reset Paper Account to {formatCurrency(resetAmount)}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Phase 7: Future Live Exchange Architecture */}
      <section className="terminal-card p-5 space-y-4 border-[#54451e]/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-[#d4af37]" />
            <div>
              <h2 className="text-sm font-bold text-[#eef2f8]">
                Exchange Integration &amp; Live Trading Architecture
              </h2>
              <p className="text-xs text-[#8190a8]">
                Pre-wired adapter boundary for future live feeds and authenticated execution
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-[#f2bd58]">
            <Lock className="w-3.5 h-3.5" />
            {liveGuard.mode}
          </span>
        </div>

        <p className="text-xs text-[#b8c4d7] leading-relaxed bg-[#070c17] border border-[#1b2940] rounded-lg p-3">
          {liveGuard.guardReason}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {FUTURE_EXCHANGE_CONNECTORS.map((ex) => (
            <div key={ex.id} className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#eef2f8]">{ex.name}</span>
                <span className="text-[10px] font-mono text-[#8190a8]">LOCKED</span>
              </div>
              <div className="text-[11px] font-mono text-[#8190a8]">
                Proxy: <span className="text-[#b8c4d7]">{ex.proxyEndpoint}</span>
              </div>
              <div className="text-[11px] text-[#8190a8]">
                Required Server Env: {ex.requiredEnvVars.join(', ')}
              </div>
              <div className="text-[10px] text-[#d4af37]">
                Auth: Server-side HMAC proxy only (no frontend keys)
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
