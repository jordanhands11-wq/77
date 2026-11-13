import { DEFAULT_STRATEGIES } from '../engine/strategies.ts';
import type { NavSection, TradingEngineState } from '../engine/types.ts';

const STORAGE_KEY = '77_trade_it_engine_state_v2';
const PREFS_KEY = '77_trade_it_user_prefs_v1';

export interface UserPreferences {
  activeNav: NavSection;
  autoTick: boolean;
  chartType: 'CANDLE' | 'LINE';
  watchlistSymbols: string[];
}

export const DEFAULT_WATCHLIST_SYMBOLS: string[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const DEFAULT_PREFS: UserPreferences = {
  activeNav: 'TRADE',
  autoTick: false,
  chartType: 'CANDLE',
  watchlistSymbols: DEFAULT_WATCHLIST_SYMBOLS,
};

export function normalizeEngineState(rawState: unknown): TradingEngineState | null {
  try {
    if (!rawState || typeof rawState !== 'object') return null;
    const parsed = rawState as TradingEngineState;
    if (parsed.mode !== 'SIMULATED_PAPER' || !parsed.markets?.BTCUSDT) {
      return null;
    }

    const defaultById = new Map(DEFAULT_STRATEGIES.map((s) => [s.id, s]));
    const normalizedStrategies = Array.isArray(parsed.strategies)
      ? parsed.strategies.map((s) => {
          const fallback = defaultById.get(s.id);
          return {
            ...fallback,
            ...s,
            template: s.template ?? fallback?.template ?? 'CONFLUENCE',
            autoExecutePaper: s.autoExecutePaper ?? false,
            params: {
              ...(fallback?.params ?? {
                fastEma: 20,
                slowEma: 50,
                rsiPeriod: 14,
                rsiBuyThreshold: 52,
                rsiSellThreshold: 48,
                bbStdDev: 2,
              }),
              ...(s.params ?? {}),
            },
            entryRules: Array.isArray(s.entryRules) ? s.entryRules : (fallback?.entryRules ?? []),
            exitRules: Array.isArray(s.exitRules) ? s.exitRules : (fallback?.exitRules ?? []),
          };
        })
      : DEFAULT_STRATEGIES;

    const normalizedSignals = Array.isArray(parsed.signals)
      ? parsed.signals.map((sig) => ({
          ...sig,
          action: sig.action ?? 'HOLD',
          category: sig.category ?? 'NEUTRAL',
          strengthLabel: sig.strengthLabel ?? 'Neutral',
          confidence: Number.isFinite(sig.confidence) ? sig.confidence : 50,
          reasons: Array.isArray(sig.reasons) ? sig.reasons : ['Evaluating indicator alignment'],
          dataSource: sig.dataSource ?? 'SIMULATED',
        }))
      : [];

    const normalizedMarkets = Object.fromEntries(
      Object.entries(parsed.markets).map(([sym, m]) => [
        sym,
        {
          ...m,
          dataSource: m.dataSource ?? 'SIMULATED',
        },
      ])
    );

    return {
      ...parsed,
      marketDataMode: parsed.marketDataMode ?? 'SIMULATED',
      selectedSymbol: normalizedMarkets[parsed.selectedSymbol] ? parsed.selectedSymbol : 'BTCUSDT',
      selectedTimeframe: parsed.selectedTimeframe ?? '1h',
      peakEquity: parsed.peakEquity ?? parsed.startingBalance ?? 100_000,
      maxDrawdownPct: parsed.maxDrawdownPct ?? 0,
      markets: normalizedMarkets,
      candleDataSources: parsed.candleDataSources ?? {},
      lastFeedSyncAt: parsed.lastFeedSyncAt,
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      openOrders: Array.isArray(parsed.openOrders) ? parsed.openOrders : [],
      orderHistory: Array.isArray(parsed.orderHistory) ? parsed.orderHistory : [],
      closedTrades: Array.isArray(parsed.closedTrades) ? parsed.closedTrades : [],
      equityHistory: Array.isArray(parsed.equityHistory) ? parsed.equityHistory : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      strategies: normalizedStrategies,
      signals: normalizedSignals,
      riskSettings: {
        ...parsed.riskSettings,
        requireStopLoss: parsed.riskSettings?.requireStopLoss ?? false,
        enforceRiskLimits: parsed.riskSettings?.enforceRiskLimits ?? true,
      },
    };
  } catch {
    return null;
  }
}

export function loadEngineState(): TradingEngineState | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem('77_trade_it_engine_state_v1');
    if (!raw) return null;
    return normalizeEngineState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveEngineState(state: TradingEngineState): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearEngineState(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem('77_trade_it_engine_state_v1');
  } catch {
    // Ignore storage errors
  }
}

const VALID_NAV_SECTIONS: readonly NavSection[] = [
  'TRADE',
  'PORTFOLIO',
  'WALLET',
  'DEPOSIT',
  'WITHDRAW',
  'MARKETS',
  'ORDERS',
  'ANALYSIS',
  'STRATEGIES',
  'HISTORY',
  'SETTINGS',
  'ADMIN',
];

export function loadUserPreferences(): UserPreferences {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_PREFS;
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const activeNav =
      parsed.activeNav && (VALID_NAV_SECTIONS as readonly string[]).includes(parsed.activeNav)
        ? parsed.activeNav
        : DEFAULT_PREFS.activeNav;
    const watchlistSymbols = Array.isArray(parsed.watchlistSymbols)
      ? parsed.watchlistSymbols.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : DEFAULT_PREFS.watchlistSymbols;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      activeNav,
      watchlistSymbols,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveUserPreferences(prefs: UserPreferences): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors
  }
}
