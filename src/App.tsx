import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Briefcase,
  CandlestickChart as ChartIcon,
  Clock,
  Cpu,
  Globe,
  ListOrdered,
  Loader2,
  LogOut,
  Pause,
  Play,
  Settings,
  Shield,
  User,
  Wallet as WalletIcon,
} from 'lucide-react';
import { livePublicCryptoProvider } from './engine/marketDataProvider.ts';
import { computePerformanceMetrics } from './engine/risk.ts';
import {
  applyExternalQuotes,
  applyHistoricalCandles,
  cancelOrder,
  closePosition,
  createCustomStrategy,
  createInitialEngineState,
  deleteCustomStrategy,
  markAllNotificationsRead,
  partialClosePosition,
  placeOrder,
  processMarketTick,
  resetPaperAccount,
  selectMarketAndTimeframe,
  setMarketDataMode,
  toggleStrategyAutoExecute,
  toggleStrategyEnabled,
  updatePositionTargets,
  updateRiskSettings,
  updateStrategyConfig,
} from './engine/tradingEngine.ts';
import type {
  MarketDataMode,
  MarketFeedStatus,
  NavSection,
  OrderRequest,
  RiskSettings,
  StrategyConfig,
  StrategyId,
  StrategyTemplate,
  Timeframe,
  TradingEngineState,
} from './engine/types.ts';
import {
  apiExecuteSimulatedTransfer,
  apiGetMe,
  apiGetTradingLedger,
  apiGetTradingState,
  apiLogout,
  apiResetTradingState,
  apiSaveTradingState,
  apiUpdateProfile,
  type AuthResponse,
  type LedgerTransactionRecord,
  type PublicUserProfile,
} from './utils/api.ts';
import {
  clearEngineState,
  loadEngineState,
  loadUserPreferences,
  normalizeEngineState,
  saveEngineState,
  saveUserPreferences,
} from './utils/storage.ts';
import { formatCurrency, formatDateTime } from './utils/format.ts';
import { AuthModal } from './components/AuthModal.tsx';
import { RhinoLogo } from './components/RhinoLogo.tsx';
import { TradeView } from './components/views/TradeView.tsx';
import { PortfolioView } from './components/views/PortfolioView.tsx';
import { MarketsView } from './components/views/MarketsView.tsx';
import { OrdersView } from './components/views/OrdersView.tsx';
import { AnalysisView } from './components/views/AnalysisView.tsx';
import { StrategiesView } from './components/views/StrategiesView.tsx';
import { HistoryView } from './components/views/HistoryView.tsx';
import { SettingsView } from './components/views/SettingsView.tsx';
import { AdminView } from './components/views/AdminView.tsx';
import { WalletView } from './components/views/WalletView.tsx';

interface NavItem {
  id: NavSection;
  label: string;
  eyebrow: string;
  title: string;
  group: 'WORKSPACE' | 'MANAGEMENT';
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'TRADE',
    label: 'Dashboard / Trade',
    eyebrow: 'Workspace / Execution Terminal',
    title: 'Trading Dashboard',
    group: 'WORKSPACE',
    icon: ChartIcon,
  },
  {
    id: 'MARKETS',
    label: 'Markets',
    eyebrow: 'Workspace / Market Quotes',
    title: 'Cryptocurrency Markets',
    group: 'WORKSPACE',
    icon: Globe,
  },
  {
    id: 'ORDERS',
    label: 'Orders & Book',
    eyebrow: 'Workspace / Order Book & Queue',
    title: 'Orders & Depth Book',
    group: 'WORKSPACE',
    icon: ListOrdered,
  },
  {
    id: 'PORTFOLIO',
    label: 'Portfolio',
    eyebrow: 'Workspace / Holdings & Balances',
    title: 'Portfolio & Asset Balances',
    group: 'WORKSPACE',
    icon: Briefcase,
  },
  {
    id: 'WALLET',
    label: 'My Wallet',
    eyebrow: 'Workspace / Simulated Wallet',
    title: 'My Simulated Wallet',
    group: 'WORKSPACE',
    icon: WalletIcon,
  },
  {
    id: 'DEPOSIT',
    label: 'Deposit',
    eyebrow: 'Workspace / Simulated Funding',
    title: 'Simulated Deposit',
    group: 'WORKSPACE',
    icon: ArrowDownLeft,
  },
  {
    id: 'WITHDRAW',
    label: 'Withdraw',
    eyebrow: 'Workspace / Simulated Payouts',
    title: 'Simulated Withdrawal',
    group: 'WORKSPACE',
    icon: ArrowUpRight,
  },
  {
    id: 'ANALYSIS',
    label: 'Analysis',
    eyebrow: '77 Intelligence / Technicals',
    title: 'Market & Indicator Analysis',
    group: 'WORKSPACE',
    icon: Activity,
  },
  {
    id: 'STRATEGIES',
    label: 'Strategies',
    eyebrow: '77 Intelligence / Quant Engine',
    title: 'Strategies & Backtester',
    group: 'WORKSPACE',
    icon: Cpu,
  },
  {
    id: 'HISTORY',
    label: 'Transaction History',
    eyebrow: 'Management / Ledger & Risk',
    title: 'Trade & Transaction History',
    group: 'MANAGEMENT',
    icon: Clock,
  },
  {
    id: 'SETTINGS',
    label: 'Account Settings',
    eyebrow: 'Management / Profile & Controls',
    title: 'Account & Terminal Settings',
    group: 'MANAGEMENT',
    icon: Settings,
  },
  {
    id: 'ADMIN',
    label: 'Admin Desk',
    eyebrow: 'Administration / RBAC Governance',
    title: 'Platform Administration',
    group: 'MANAGEMENT',
    icon: Shield,
  },
];

export default function App() {
  const initialPrefs = useMemo(() => loadUserPreferences(), []);
  const [engineState, setEngineState] = useState<TradingEngineState>(
    () => loadEngineState() ?? createInitialEngineState({ startingBalance: 100_000 })
  );
  const [activeNav, setActiveNav] = useState<NavSection>(
    initialPrefs.activeNav === 'ADMIN' ? 'TRADE' : initialPrefs.activeNav
  );
  const [autoTick, setAutoTick] = useState<boolean>(initialPrefs.autoTick);
  const [chartType, setChartType] = useState<'CANDLE' | 'LINE'>(initialPrefs.chartType);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>(
    initialPrefs.watchlistSymbols
  );
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [showProfile, setShowProfile] = useState<boolean>(false);

  const [currentUser, setCurrentUser] = useState<PublicUserProfile | null>(null);
  const [persistedLedger, setPersistedLedger] = useState<LedgerTransactionRecord[]>([]);
  const [isHydratingSession, setIsHydratingSession] = useState<boolean>(true);
  const [authModalMode, setAuthModalMode] = useState<'LOGIN' | 'REGISTER' | null>(null);
  const [lastServerSyncAt, setLastServerSyncAt] = useState<number | null>(null);
  const [serverSyncError, setServerSyncError] = useState<string | null>(null);

  const [feedStatus, setFeedStatus] = useState<MarketFeedStatus>(() =>
    engineState.marketDataMode === 'LIVE_PUBLIC_READONLY' ? 'CONNECTING' : 'SIMULATED'
  );
  const [feedProviderName, setFeedProviderName] = useState<string>(() =>
    engineState.marketDataMode === 'LIVE_PUBLIC_READONLY'
      ? 'Binance / Coinbase Public Feed'
      : 'Simulated Market Engine'
  );
  const [lastFeedUpdatedAt, setLastFeedUpdatedAt] = useState<number | null>(
    engineState.lastFeedSyncAt ?? null
  );
  const [feedError, setFeedError] = useState<string | null>(null);
  const [isRefreshingFeed, setIsRefreshingFeed] = useState<boolean>(false);
  const [isLoadingCandles, setIsLoadingCandles] = useState<boolean>(false);
  const [candleError, setCandleError] = useState<string | null>(null);

  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const skipNextServerSyncRef = useRef<boolean>(false);
  const engineStateRef = useRef<TradingEngineState>(engineState);
  engineStateRef.current = engineState;
  const liveCycleCountRef = useRef<number>(0);

  // Save browser fallback cache
  useEffect(() => {
    saveEngineState(engineState);
  }, [engineState]);

  useEffect(() => {
    saveUserPreferences({ activeNav, autoTick, chartType, watchlistSymbols });
  }, [activeNav, autoTick, chartType, watchlistSymbols]);

  const refreshUserLedger = useCallback(async () => {
    try {
      const ledgerRes = await apiGetTradingLedger(150);
      setPersistedLedger(ledgerRes.transactions);
    } catch {
      // Ignore if unauthenticated
    }
  }, []);

  // Hydrate authenticated session & server-persisted portfolio on mount
  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const me = await apiGetMe();
        if (!active) return;
        if (me.authenticated && me.user) {
          setCurrentUser(me.user);
          const [remote, ledgerRes] = await Promise.all([
            apiGetTradingState(),
            apiGetTradingLedger(150),
          ]);
          if (!active) return;
          const normalized = normalizeEngineState(remote.state);
          if (normalized) {
            skipNextServerSyncRef.current = true;
            setEngineState(normalized);
          }
          setPersistedLedger(ledgerRes.transactions);
          setLastServerSyncAt(remote.updatedAt);
          setServerSyncError(null);
        }
      } catch {
        // Offline or guest mode: retain local cache cleanly
      } finally {
        if (active) setIsHydratingSession(false);
      }
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  // Debounced persistence to backend SQLite DB when signed in
  useEffect(() => {
    if (!currentUser) return;
    if (skipNextServerSyncRef.current) {
      skipNextServerSyncRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void apiSaveTradingState(engineState)
        .then((res) => {
          setLastServerSyncAt(res.updatedAt);
          setServerSyncError(null);
          void refreshUserLedger();
        })
        .catch((err) => {
          setServerSyncError(
            err instanceof Error ? err.message : 'Unable to sync portfolio to server.'
          );
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [engineState, currentUser, refreshUserLedger]);

  // Close popovers on outside click/tap or Escape key
  useEffect(() => {
    if (!showNotifications && !showProfile) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        showNotifications &&
        notificationsRef.current &&
        !notificationsRef.current.contains(target)
      ) {
        setShowNotifications(false);
      }
      if (showProfile && profileRef.current && !profileRef.current.contains(target)) {
        setShowProfile(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowNotifications(false);
        setShowProfile(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showNotifications, showProfile]);

  const fetchHistoricalCandlesForPair = useCallback(
    async (symbol: string, timeframe: Timeframe): Promise<boolean> => {
      setIsLoadingCandles(true);
      setCandleError(null);
      try {
        const res = await livePublicCryptoProvider.fetchHistoricalCandles(symbol, timeframe, 120);
        if (!res.ok || res.candles.length === 0) {
          setCandleError(
            res.error ?? `Historical ${timeframe} candles unavailable for ${symbol}.`
          );
          return false;
        }
        setEngineState((prev) =>
          applyHistoricalCandles(prev, symbol, timeframe, res.candles, {
            dataSource: 'LIVE_PUBLIC',
            providerName: res.providerName,
            fetchedAt: res.fetchedAt,
          })
        );
        return true;
      } catch (err) {
        setCandleError(
          err instanceof Error ? err.message : `Failed to fetch ${symbol} ${timeframe} candles.`
        );
        return false;
      } finally {
        setIsLoadingCandles(false);
      }
    },
    []
  );

  const refreshLiveMarketData = useCallback(
    async (options?: {
      includeCandles?: boolean;
      symbol?: string;
      timeframe?: Timeframe;
    }): Promise<boolean> => {
      const curr = engineStateRef.current;
      const symbols = Object.keys(curr.markets);
      const targetSymbol = options?.symbol ?? curr.selectedSymbol;
      const targetTimeframe = options?.timeframe ?? curr.selectedTimeframe;
      const includeCandles = options?.includeCandles ?? true;

      setIsRefreshingFeed(true);
      if (includeCandles) {
        setIsLoadingCandles(true);
        setCandleError(null);
      }

      try {
        const quotesPromise = livePublicCryptoProvider.fetchQuotesDetailed(symbols);
        const candlesPromise = includeCandles
          ? livePublicCryptoProvider.fetchHistoricalCandles(targetSymbol, targetTimeframe, 120)
          : Promise.resolve(null);

        const [quotesRes, candlesRes] = await Promise.all([quotesPromise, candlesPromise]);

        if (quotesRes.status === 'UNAVAILABLE' || Object.keys(quotesRes.quotes).length === 0) {
          setFeedStatus('UNAVAILABLE');
          setFeedProviderName(quotesRes.providerName);
          setFeedError(
            quotesRes.error ??
              'Public market feed is unreachable. Simulated prices are not substituted as live.'
          );
          if (candlesRes && !candlesRes.ok) {
            setCandleError(candlesRes.error ?? 'Historical OHLCV feed unavailable.');
          }
          return false;
        }

        setEngineState((prev) => {
          let next = applyExternalQuotes(prev, quotesRes.quotes);
          if (candlesRes && candlesRes.ok && candlesRes.candles.length > 0) {
            next = applyHistoricalCandles(next, targetSymbol, targetTimeframe, candlesRes.candles, {
              dataSource: 'LIVE_PUBLIC',
              providerName: candlesRes.providerName,
              fetchedAt: candlesRes.fetchedAt,
            });
          }
          return next;
        });

        setFeedStatus(quotesRes.status);
        setFeedProviderName(quotesRes.providerName);
        setLastFeedUpdatedAt(quotesRes.fetchedAt);
        setFeedError(
          quotesRes.status === 'PARTIAL'
            ? quotesRes.error ?? 'Some pairs lacked live quotes and display simulated fallback.'
            : null
        );
        if (candlesRes && !candlesRes.ok) {
          setCandleError(
            candlesRes.error ??
              `Historical ${targetTimeframe} candles unavailable for ${targetSymbol}.`
          );
        }
        return true;
      } catch (err) {
        setFeedStatus('UNAVAILABLE');
        setFeedError(
          err instanceof Error ? err.message : 'Unable to refresh live public market data.'
        );
        return false;
      } finally {
        setIsRefreshingFeed(false);
        if (includeCandles) {
          setIsLoadingCandles(false);
        }
      }
    },
    []
  );

  const fetchLivePublicQuotes = useCallback(async (): Promise<boolean> => {
    return refreshLiveMarketData({ includeCandles: true });
  }, [refreshLiveMarketData]);

  // Initial sync if loaded directly in LIVE_PUBLIC_READONLY mode
  useEffect(() => {
    if (engineState.marketDataMode === 'LIVE_PUBLIC_READONLY') {
      setFeedStatus('CONNECTING');
      void refreshLiveMarketData({ includeCandles: true });
    } else {
      setFeedStatus('SIMULATED');
      setFeedProviderName('Simulated Market Engine');
      setFeedError(null);
      setCandleError(null);
    }
    // Only re-run when mode itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineState.marketDataMode]);

  // Mark feed delayed if live quotes haven't refreshed within 45s
  useEffect(() => {
    if (engineState.marketDataMode !== 'LIVE_PUBLIC_READONLY') return;
    const checker = window.setInterval(() => {
      if (!lastFeedUpdatedAt) return;
      const ageMs = Date.now() - lastFeedUpdatedAt;
      if (ageMs > 45_000) {
        setFeedStatus((prev) => (prev === 'LIVE' || prev === 'PARTIAL' ? 'DELAYED' : prev));
      }
    }, 10_000);
    return () => window.clearInterval(checker);
  }, [engineState.marketDataMode, lastFeedUpdatedAt]);

  // Auto-refresh interval: live public polling (5s quotes, 30s OHLCV candles) OR simulated ticks (3s)
  useEffect(() => {
    if (!autoTick) return;
    const intervalMs = engineState.marketDataMode === 'LIVE_PUBLIC_READONLY' ? 5000 : 3000;
    const timer = window.setInterval(() => {
      if (engineStateRef.current.marketDataMode === 'LIVE_PUBLIC_READONLY') {
        liveCycleCountRef.current += 1;
        const includeCandles = liveCycleCountRef.current % 6 === 0;
        void refreshLiveMarketData({ includeCandles });
      } else {
        setEngineState((prev) => processMarketTick(prev, Date.now() % 10000));
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoTick, engineState.marketDataMode, refreshLiveMarketData]);

  const metrics = useMemo(() => computePerformanceMetrics(engineState), [engineState]);
  const unreadCount = engineState.notifications.filter((n) => !n.read).length;
  const activeMeta = NAV_ITEMS.find((n) => n.id === activeNav) ?? NAV_ITEMS[0];

  const handleAuthSuccess = (auth: AuthResponse) => {
    setCurrentUser(auth.user);
    const normalized = normalizeEngineState(auth.tradingState);
    if (normalized) {
      skipNextServerSyncRef.current = true;
      setEngineState(normalized);
    }
    setLastServerSyncAt(Date.now());
    setServerSyncError(null);
    setAuthModalMode(null);
    setShowProfile(false);
    void refreshUserLedger();
  };

  const handleLogout = async () => {
    await apiLogout();
    setCurrentUser(null);
    setPersistedLedger([]);
    if (activeNav === 'ADMIN') setActiveNav('TRADE');
    setLastServerSyncAt(null);
    setServerSyncError(null);
    setShowProfile(false);
  };

  const handleUpdateProfile = async (patch: {
    displayName?: string;
    handle?: string;
    baseCurrency?: 'USD' | 'EUR' | 'GBP';
    bio?: string;
    timezone?: string;
  }) => {
    const updated = await apiUpdateProfile(patch);
    setCurrentUser(updated);
  };

  const handleSimulatedTransfer = async (input: {
    direction: 'SIMULATED_DEPOSIT' | 'SIMULATED_WITHDRAWAL';
    amount: number;
    note?: string;
    idempotencyKey: string;
  }) => {
    const res = await apiExecuteSimulatedTransfer(input);
    skipNextServerSyncRef.current = true;
    setEngineState(res.state);
    setLastServerSyncAt(res.updatedAt);
    setServerSyncError(null);
    await refreshUserLedger();
  };

  const handleWalletStateSynced = (nextState: TradingEngineState) => {
    skipNextServerSyncRef.current = true;
    setEngineState(nextState);
    setLastServerSyncAt(Date.now());
    setServerSyncError(null);
    void refreshUserLedger();
  };

  const handleAdminWalletUpdated = async () => {
    try {
      const remote = await apiGetTradingState();
      const normalized = normalizeEngineState(remote.state);
      if (normalized) {
        skipNextServerSyncRef.current = true;
        setEngineState(normalized);
        setLastServerSyncAt(remote.updatedAt);
      }
      await refreshUserLedger();
    } catch {
      // Ignore transient sync failure
    }
  };

  const handleStepTick = () => {
    setEngineState((prev) => processMarketTick(prev));
  };

  const handleSelectSymbol = (symbol: string) => {
    setEngineState((prev) => selectMarketAndTimeframe(prev, symbol, undefined));
    if (engineStateRef.current.marketDataMode === 'LIVE_PUBLIC_READONLY') {
      void fetchHistoricalCandlesForPair(symbol, engineStateRef.current.selectedTimeframe);
    }
  };

  const handleSelectTimeframe = (tf: Timeframe) => {
    setEngineState((prev) => selectMarketAndTimeframe(prev, undefined, tf));
    if (engineStateRef.current.marketDataMode === 'LIVE_PUBLIC_READONLY') {
      void fetchHistoricalCandlesForPair(engineStateRef.current.selectedSymbol, tf);
    }
  };

  const handleTradeSymbol = (symbol: string) => {
    setEngineState((prev) => selectMarketAndTimeframe(prev, symbol, undefined));
    setActiveNav('TRADE');
    if (engineStateRef.current.marketDataMode === 'LIVE_PUBLIC_READONLY') {
      void fetchHistoricalCandlesForPair(symbol, engineStateRef.current.selectedTimeframe);
    }
  };

  const handleSubmitOrder = (req: OrderRequest) => {
    let result: { accepted: boolean; errors: string[] } = { accepted: false, errors: [] };
    setEngineState((prev) => {
      const next = placeOrder(prev, req);
      result = { accepted: next.accepted, errors: next.errors };
      return next.state;
    });
    return result;
  };

  const handleCancelOrder = (orderId: string) => {
    setEngineState((prev) => cancelOrder(prev, orderId));
  };

  const handleClosePosition = (positionId: string) => {
    setEngineState((prev) => closePosition(prev, positionId, 'MANUAL'));
  };

  const handlePartialClosePosition = (positionId: string, fraction: number) => {
    setEngineState((prev) => partialClosePosition(prev, positionId, fraction, 'MANUAL'));
  };

  const handleUpdatePositionTargets = (
    positionId: string,
    stopLoss?: number,
    takeProfit?: number
  ) => {
    let result: { accepted: boolean; errors: string[] } = { accepted: false, errors: [] };
    setEngineState((prev) => {
      const next = updatePositionTargets(prev, positionId, stopLoss, takeProfit);
      result = { accepted: next.accepted, errors: next.errors };
      return next.state;
    });
    return result;
  };

  const handleEmergencyCloseAll = () => {
    setEngineState((prev) => {
      let curr = prev;
      for (const pos of [...curr.positions]) {
        curr = closePosition(curr, pos.id, 'MANUAL');
      }
      return curr;
    });
  };

  const handleToggleStrategy = (id: StrategyId) => {
    setEngineState((prev) => toggleStrategyEnabled(prev, id));
  };

  const handleToggleStrategyAutoExecute = (id: StrategyId) => {
    setEngineState((prev) => toggleStrategyAutoExecute(prev, id));
  };

  const handleUpdateStrategy = (
    id: StrategyId,
    patch: Partial<Omit<StrategyConfig, 'id' | 'params'>> & {
      params?: Partial<StrategyConfig['params']>;
    }
  ) => {
    setEngineState((prev) => updateStrategyConfig(prev, id, patch));
  };

  const handleCreateStrategy = (input: {
    name: string;
    subtitle: string;
    description: string;
    template: StrategyTemplate;
    timeframe: Timeframe;
    riskPerTradePct: number;
    stopLossAtrMult: number;
    takeProfitRrMult: number;
    rsiBuyThreshold: number;
    rsiSellThreshold: number;
  }) => {
    setEngineState((prev) => createCustomStrategy(prev, input));
  };

  const handleDeleteStrategy = (id: StrategyId) => {
    setEngineState((prev) => deleteCustomStrategy(prev, id));
  };

  const handleUpdateRisk = (patch: Partial<RiskSettings>) => {
    setEngineState((prev) => updateRiskSettings(prev, patch));
  };

  const handleToggleWatchlist = useCallback((symbol: string) => {
    setWatchlistSymbols((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  }, []);

  const handleMarketDataModeChange = (mode: MarketDataMode) => {
    setEngineState((prev) => setMarketDataMode(prev, mode));
    if (mode === 'SIMULATED') {
      setFeedStatus('SIMULATED');
      setFeedProviderName('Simulated Market Engine');
      setFeedError(null);
      setCandleError(null);
    }
  };

  const handleResetAccount = async (startingBalance: number) => {
    clearEngineState();
    setAutoTick(false);
    if (currentUser) {
      try {
        const res = await apiResetTradingState(startingBalance);
        skipNextServerSyncRef.current = true;
        setEngineState(res.state);
        setLastServerSyncAt(res.updatedAt);
        setServerSyncError(null);
        return;
      } catch (err) {
        setServerSyncError(
          err instanceof Error ? err.message : 'Unable to reset remote paper portfolio.'
        );
      }
    }
    setEngineState(resetPaperAccount(startingBalance));
  };

  const workspaceNav = NAV_ITEMS.filter((n) => n.group === 'WORKSPACE');
  const managementNav = NAV_ITEMS.filter(
    (n) => n.group === 'MANAGEMENT' && (n.id !== 'ADMIN' || currentUser?.role === 'ADMIN')
  );
  const isLiveQuotes = engineState.marketDataMode === 'LIVE_PUBLIC_READONLY';

  return (
    <div className="min-h-screen flex bg-transparent text-[#eef2f8] overflow-x-hidden">
      {/* Left Institutional Sidebar */}
      <aside className="hidden md:flex w-[238px] shrink-0 bg-[#070c17] border-r border-[#1b2940] px-4 py-6 flex-col gap-6 sticky top-0 h-screen">
        {/* Brand Identity */}
        <div className="flex items-center gap-3 px-1">
          <RhinoLogo size={38} />
          <div>
            <div className="text-[18px] font-extrabold tracking-[1.4px] text-[#f3dc8d] leading-none whitespace-nowrap">
              77 TRADE IT
            </div>
            <div className="text-[9px] tracking-[2.2px] text-[#8190a8] mt-1.5 uppercase whitespace-nowrap">
              Analyse · Trade · Profit
            </div>
          </div>
        </div>

        {/* Paper Mode Indicator */}
        <div className="border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] rounded-lg px-3 py-2 text-[10px] font-extrabold tracking-[1px] text-center uppercase">
          Simulated Paper Mode
        </div>

        {/* Primary Navigation */}
        <nav className="flex-1 space-y-5 overflow-y-auto" aria-label="Main Navigation">
          <div>
            <div className="text-[10px] tracking-[1.5px] text-[#61708a] px-2.5 mb-2 uppercase font-semibold">
              Workspace
            </div>
            <div className="space-y-1">
              {workspaceNav.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-gradient-to-r from-[#2a2414] to-[#171b24] text-[#f3dc8d] border border-[#54451e]'
                        : 'text-[#aab5c8] hover:text-[#eef2f8] hover:bg-[#0e172a]/60 border border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] tracking-[1.5px] text-[#61708a] px-2.5 mb-2 uppercase font-semibold">
              Management
            </div>
            <div className="space-y-1">
              {managementNav.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-gradient-to-r from-[#2a2414] to-[#171b24] text-[#f3dc8d] border border-[#54451e]'
                        : 'text-[#aab5c8] hover:text-[#eef2f8] hover:bg-[#0e172a]/60 border border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <div className="pt-4 border-t border-[#1b2940] text-[11px] text-[#61708a] leading-relaxed">
          <div className="font-semibold text-[#b8c4d7]">
            {currentUser ? currentUser.displayName : '77 TRADE IT'}
          </div>
          <div>
            {currentUser ? `@${currentUser.handle} · Server Sync` : 'Guest paper environment'}
          </div>
          <div className="text-[#d4af37] mt-0.5">
            {isLiveQuotes ? 'Public quotes · Paper fills' : 'Simulated market quotes'}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Terminal Header */}
        <header className="sticky top-0 z-30 bg-[#050811]/90 backdrop-blur-md border-b border-[#1b2940] px-3 py-2.5 sm:px-7 sm:py-3.5">
          <div className="max-w-[1520px] mx-auto flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="md:hidden shrink-0">
                <RhinoLogo size={30} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] sm:text-[11px] uppercase tracking-[1.4px] text-[#8190a8] truncate">
                  {activeMeta.eyebrow}
                </div>
                <h1 className="text-base sm:text-xl font-bold text-[#eef2f8] truncate">
                  {activeMeta.title}
                </h1>
              </div>
            </div>

            {/* Header Controls: Market Status, Sim Stepper, Notifications, Profile, Settings */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <div className="hidden lg:flex items-center gap-2 text-xs text-[#b8c4d7] px-3 py-1.5 rounded-lg bg-[#0b1220] border border-[#1b2940] whitespace-nowrap">
                <span
                  className={
                    !isLiveQuotes
                      ? 'text-[#37d69a] font-semibold'
                      : feedStatus === 'LIVE'
                        ? 'text-[#37d69a] font-semibold'
                        : feedStatus === 'UNAVAILABLE'
                          ? 'text-[#ff667a] font-semibold'
                          : 'text-[#f2bd58] font-semibold'
                  }
                >
                  {!isLiveQuotes
                    ? 'Simulated Data'
                    : feedStatus === 'LIVE'
                      ? 'Live Public Feed'
                      : feedStatus === 'PARTIAL'
                        ? 'Live Partial Feed'
                        : feedStatus === 'DELAYED'
                          ? 'Live Delayed'
                          : feedStatus === 'CONNECTING'
                            ? 'Connecting Live...'
                            : 'Live Unavailable'}
                </span>
                <span aria-hidden="true" className="text-[#61708a]">·</span>
                <span className="font-mono tabular-nums">
                  {isLiveQuotes && lastFeedUpdatedAt ? (
                    <strong className="text-[#f3dc8d]">{formatDateTime(lastFeedUpdatedAt)}</strong>
                  ) : (
                    <>
                      Tick <strong className="text-[#f3dc8d]">{String(engineState.tick).padStart(3, '0')}</strong>
                    </>
                  )}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setAutoTick((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 min-h-[38px] rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  autoTick
                    ? 'border-[#1b5547] bg-[#102b27] text-[#37d69a]'
                    : 'border-[#1b2940] bg-[#0b1220] text-[#b8c4d7] hover:text-[#eef2f8]'
                }`}
                title="Toggle automatic market feed updates"
              >
                {autoTick ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{autoTick ? 'Pause Feed' : 'Auto Feed'}</span>
              </button>

              {isLiveQuotes ? (
                <button
                  type="button"
                  disabled={isRefreshingFeed}
                  onClick={() => void refreshLiveMarketData({ includeCandles: true })}
                  className="gold-button px-2.5 sm:px-3.5 min-h-[38px] rounded-lg text-[11px] sm:text-xs whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  {isRefreshingFeed ? 'SYNCING...' : 'SYNC LIVE'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStepTick}
                  className="gold-button px-2.5 sm:px-3.5 min-h-[38px] rounded-lg text-[11px] sm:text-xs whitespace-nowrap shrink-0"
                >
                  STEP +1
                </button>
              )}

              {/* Notifications Popover */}
              <div ref={notificationsRef} className="relative">
                <button
                  type="button"
                  aria-label="Notifications"
                  onClick={() => {
                    setShowNotifications((v) => !v);
                    setShowProfile(false);
                  }}
                  className="relative p-2 min-w-[38px] min-h-[38px] grid place-items-center rounded-lg bg-[#0b1220] border border-[#1b2940] text-[#b8c4d7] hover:text-[#f3dc8d] transition-colors"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#d4af37] text-[#15120a] text-[10px] font-bold grid place-items-center tabular-nums">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-72 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-[#0b1222] border border-[#1b2940] rounded-xl shadow-2xl p-3 z-50">
                    <div className="flex items-center justify-between border-b border-[#1b2940] pb-2 mb-2">
                      <span className="text-xs font-bold text-[#eef2f8]">Notifications</span>
                      <button
                        type="button"
                        onClick={() => setEngineState((prev) => markAllNotificationsRead(prev))}
                        className="text-[11px] text-[#d4af37] hover:underline"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#1b2940]">
                      {engineState.notifications.length === 0 ? (
                        <div className="py-4 text-center text-xs text-[#8190a8]">
                          No notifications yet.
                        </div>
                      ) : (
                        engineState.notifications.slice(0, 10).map((n) => (
                          <div key={n.id} className="py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[#eef2f8]">{n.title}</span>
                              <span className="text-[10px] text-[#8190a8] font-mono">
                                {formatDateTime(n.timestamp)}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#8190a8] mt-0.5">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User Profile Popover */}
              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  aria-label="Account profile"
                  onClick={() => {
                    setShowProfile((v) => !v);
                    setShowNotifications(false);
                  }}
                  className={`relative p-2 min-w-[38px] min-h-[38px] grid place-items-center rounded-lg border transition-colors ${
                    currentUser
                      ? 'bg-[#211c0e] border-[#594b22] text-[#f3dc8d]'
                      : 'bg-[#0b1220] border-[#1b2940] text-[#b8c4d7] hover:text-[#f3dc8d]'
                  }`}
                >
                  <User className="w-4 h-4" />
                  {currentUser && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#37d69a] border-2 border-[#050811]" />
                  )}
                </button>

                {showProfile && (
                  <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-[#0b1222] border border-[#1b2940] rounded-xl shadow-2xl p-3.5 z-50 space-y-2.5 text-xs">
                    {currentUser ? (
                      <>
                        <div className="border-b border-[#1b2940] pb-2">
                          <div className="font-bold text-[#f3dc8d] truncate">
                            {currentUser.displayName}
                          </div>
                          <div className="text-[11px] text-[#8190a8] truncate">
                            @{currentUser.handle} · {currentUser.email}
                          </div>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#8190a8]">Paper Equity</span>
                          <span className="font-mono font-bold text-[#eef2f8] tabular-nums">
                            {formatCurrency(metrics.totalEquity)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#8190a8]">Open Positions</span>
                          <span className="font-mono text-[#eef2f8]">
                            {engineState.positions.length}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowProfile(false);
                            setActiveNav('SETTINGS');
                          }}
                          className="w-full min-h-[38px] py-1.5 rounded-lg border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] font-semibold"
                        >
                          Profile &amp; Account Settings
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLogout()}
                          className="w-full min-h-[38px] py-1.5 rounded-lg border border-[#1b2940] text-[#b8c4d7] hover:text-[#ff667a] hover:border-[#5d2331] font-semibold inline-flex items-center justify-center gap-1.5"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Sign Out
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="border-b border-[#1b2940] pb-2">
                          <div className="font-bold text-[#f3dc8d]">Guest Paper Desk</div>
                          <div className="text-[11px] text-[#8190a8]">
                            Local browser session (SIM-77-PAPER)
                          </div>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#8190a8]">Equity</span>
                          <span className="font-mono font-bold text-[#eef2f8] tabular-nums">
                            {formatCurrency(metrics.totalEquity)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowProfile(false);
                              setAuthModalMode('LOGIN');
                            }}
                            className="gold-button min-h-[38px] py-1.5 rounded-lg font-bold"
                          >
                            Sign In
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowProfile(false);
                              setAuthModalMode('REGISTER');
                            }}
                            className="min-h-[38px] py-1.5 rounded-lg border border-[#594b22] bg-[#211c0e] text-[#f3dc8d] font-semibold"
                          >
                            Register
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowProfile(false);
                            setActiveNav('SETTINGS');
                          }}
                          className="w-full min-h-[36px] py-1.5 rounded-lg border border-[#1b2940] text-[#b8c4d7] hover:text-[#eef2f8] font-medium"
                        >
                          Risk &amp; Terminal Settings
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Direct Settings Shortcut */}
              <button
                type="button"
                aria-label="Open Settings"
                onClick={() => setActiveNav('SETTINGS')}
                className="hidden sm:inline-flex p-2 min-w-[38px] min-h-[38px] items-center justify-center rounded-lg bg-[#0b1220] border border-[#1b2940] text-[#b8c4d7] hover:text-[#f3dc8d] transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Active View Content */}
        <main className="flex-1 p-3.5 sm:p-7 pb-24 md:pb-10 max-w-[1520px] w-full mx-auto">
          {isHydratingSession && (
            <div className="mb-4 px-3.5 py-2 rounded-lg bg-[#0b1222] border border-[#1b2940] text-xs text-[#b8c4d7] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#d4af37]" />
              <span>Synchronizing session and paper trading state...</span>
            </div>
          )}

          {serverSyncError && (
            <div className="mb-4 px-3.5 py-2 rounded-lg bg-[#2c121a]/80 border border-[#5d2331] text-xs text-[#ff667a] flex items-center justify-between gap-2">
              <span>Server sync warning: {serverSyncError}</span>
              <button
                type="button"
                onClick={() => setServerSyncError(null)}
                className="text-[11px] underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeNav === 'TRADE' && (
            <TradeView
              state={engineState}
              chartType={chartType}
              watchlistSymbols={watchlistSymbols}
              feedStatus={feedStatus}
              feedError={feedError}
              lastFeedUpdatedAt={lastFeedUpdatedAt}
              isLoadingCandles={isLoadingCandles}
              candleError={candleError}
              onChartTypeChange={setChartType}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectSymbol={handleSelectSymbol}
              onSelectTimeframe={handleSelectTimeframe}
              onMarketDataModeChange={handleMarketDataModeChange}
              onRefreshLiveFeed={fetchLivePublicQuotes}
              onSubmitOrder={handleSubmitOrder}
              onCancelOrder={handleCancelOrder}
              onClosePosition={handleClosePosition}
              onPartialClosePosition={handlePartialClosePosition}
              onUpdatePositionTargets={handleUpdatePositionTargets}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'PORTFOLIO' && (
            <PortfolioView
              state={engineState}
              isAuthenticated={Boolean(currentUser)}
              onSimulatedTransfer={handleSimulatedTransfer}
              onOpenAuthModal={(mode) => setAuthModalMode(mode)}
              onClosePosition={handleClosePosition}
              onPartialClosePosition={handlePartialClosePosition}
              onUpdatePositionTargets={handleUpdatePositionTargets}
              onSelectSymbolAndTrade={handleTradeSymbol}
              onNavigate={setActiveNav}
            />
          )}

          {(activeNav === 'WALLET' || activeNav === 'DEPOSIT' || activeNav === 'WITHDRAW') && (
            <WalletView
              initialTab={
                activeNav === 'DEPOSIT'
                  ? 'DEPOSIT'
                  : activeNav === 'WITHDRAW'
                    ? 'WITHDRAW'
                    : 'OVERVIEW'
              }
              state={engineState}
              isAuthenticated={Boolean(currentUser)}
              onOpenAuthModal={(mode) => setAuthModalMode(mode)}
              onWalletStateSynced={handleWalletStateSynced}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'MARKETS' && (
            <MarketsView
              state={engineState}
              watchlistSymbols={watchlistSymbols}
              feedStatus={feedStatus}
              feedProviderName={feedProviderName}
              lastFeedUpdatedAt={lastFeedUpdatedAt}
              feedError={feedError}
              isRefreshingFeed={isRefreshingFeed}
              onToggleWatchlist={handleToggleWatchlist}
              onTradeSymbol={handleTradeSymbol}
              onMarketDataModeChange={handleMarketDataModeChange}
              onRefreshLiveFeed={fetchLivePublicQuotes}
            />
          )}

          {activeNav === 'ORDERS' && (
            <OrdersView
              state={engineState}
              onSelectSymbol={handleSelectSymbol}
              onCancelOrder={handleCancelOrder}
              onNavigate={setActiveNav}
            />
          )}

          {activeNav === 'ANALYSIS' && (
            <AnalysisView
              state={engineState}
              onSelectSymbol={handleSelectSymbol}
              onSelectTimeframe={handleSelectTimeframe}
              onTradeSymbol={handleTradeSymbol}
            />
          )}

          {activeNav === 'STRATEGIES' && (
            <StrategiesView
              state={engineState}
              onToggleStrategy={handleToggleStrategy}
              onToggleAutoExecute={handleToggleStrategyAutoExecute}
              onUpdateStrategy={handleUpdateStrategy}
              onCreateStrategy={handleCreateStrategy}
              onDeleteStrategy={handleDeleteStrategy}
              onExecuteSignalOrder={handleSubmitOrder}
            />
          )}

          {activeNav === 'HISTORY' && (
            <HistoryView
              state={engineState}
              persistedLedger={persistedLedger}
              onEmergencyCloseAll={handleEmergencyCloseAll}
            />
          )}

          {activeNav === 'SETTINGS' && (
            <SettingsView
              state={engineState}
              currentUser={currentUser}
              lastServerSyncAt={lastServerSyncAt}
              serverSyncError={serverSyncError}
              feedStatus={feedStatus}
              feedProviderName={feedProviderName}
              lastFeedUpdatedAt={lastFeedUpdatedAt}
              feedError={feedError}
              onOpenAuthModal={(mode) => setAuthModalMode(mode)}
              onLogout={handleLogout}
              onUpdateProfile={handleUpdateProfile}
              onUserProfileUpdated={setCurrentUser}
              onNavigate={setActiveNav}
              onUpdateRisk={handleUpdateRisk}
              onResetAccount={handleResetAccount}
              onMarketDataModeChange={handleMarketDataModeChange}
              onFetchLivePublicQuotes={fetchLivePublicQuotes}
            />
          )}

          {activeNav === 'ADMIN' && currentUser?.role === 'ADMIN' && (
            <AdminView
              currentUser={currentUser}
              onAdminWalletUpdated={handleAdminWalletUpdated}
            />
          )}

          <footer className="mt-8 pt-4 border-t border-[#1b2940] text-[11px] text-[#65738a] flex flex-wrap items-center justify-between gap-2">
            <span>
              77 TRADE IT · Simulated Paper Trading Terminal · All order executions and account balances are strictly simulated paper trading.
            </span>
            <span className="font-mono text-[#8190a8]">
              Feed: {engineState.marketDataMode} ({feedStatus})
            </span>
          </footer>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080e1b]/95 backdrop-blur-md border-t border-[#1b2940] flex items-center gap-1 overflow-x-auto pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] px-1.5"
        aria-label="Mobile Navigation"
      >
        {[
          { id: 'TRADE' as NavSection, label: 'Trade', icon: ChartIcon },
          { id: 'MARKETS' as NavSection, label: 'Markets', icon: Globe },
          { id: 'ORDERS' as NavSection, label: 'Orders', icon: ListOrdered },
          { id: 'PORTFOLIO' as NavSection, label: 'Portfolio', icon: Briefcase },
          { id: 'WALLET' as NavSection, label: 'Wallet', icon: WalletIcon },
          { id: 'DEPOSIT' as NavSection, label: 'Deposit', icon: ArrowDownLeft },
          { id: 'WITHDRAW' as NavSection, label: 'Withdraw', icon: ArrowUpRight },
          { id: 'ANALYSIS' as NavSection, label: 'Analysis', icon: Activity },
          { id: 'STRATEGIES' as NavSection, label: 'Quant', icon: Cpu },
          { id: 'HISTORY' as NavSection, label: 'History', icon: Clock },
          { id: 'SETTINGS' as NavSection, label: 'Account', icon: Settings },
          ...(currentUser?.role === 'ADMIN'
            ? [{ id: 'ADMIN' as NavSection, label: 'Admin', icon: Shield }]
            : []),
        ].map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              className={`min-h-[48px] min-w-[54px] flex-1 flex flex-col items-center justify-center px-1.5 py-1 text-[10px] font-medium rounded-lg shrink-0 ${
                active ? 'text-[#f3dc8d]' : 'text-[#8795aa]'
              }`}
            >
              <Icon className="w-4 h-4 mb-0.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Trader Sign In / Registration Modal */}
      <AuthModal
        open={authModalMode !== null}
        initialMode={authModalMode ?? 'LOGIN'}
        onClose={() => setAuthModalMode(null)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
