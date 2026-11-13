import React, { useMemo, useState } from 'react';
import { Play, Pause, FlaskConical, Zap, Plus, Trash2, Bot } from 'lucide-react';
import { TIMEFRAMES } from '../../engine/marketData.ts';
import { isBuySignal, isSellSignal, runBacktest } from '../../engine/strategies.ts';
import {
  calculateSuggestedPositionSize,
  computePerformanceMetrics,
  computeStrategyAttribution,
} from '../../engine/risk.ts';
import type {
  BacktestResult,
  OrderRequest,
  StrategyConfig,
  StrategyId,
  StrategyTemplate,
  Timeframe,
  TradingEngineState,
} from '../../engine/types.ts';
import { formatAssetPrice, formatCurrency, formatDateTime, formatPercent } from '../../utils/format.ts';
import { EquityAreaChart } from '../VisualWidgets.tsx';

interface StrategiesViewProps {
  state: TradingEngineState;
  onToggleStrategy: (id: StrategyId) => void;
  onToggleAutoExecute: (id: StrategyId) => void;
  onUpdateStrategy: (
    id: StrategyId,
    patch: Partial<Omit<StrategyConfig, 'id' | 'params'>> & {
      params?: Partial<StrategyConfig['params']>;
    }
  ) => void;
  onCreateStrategy: (input: {
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
  }) => void;
  onDeleteStrategy: (id: StrategyId) => void;
  onExecuteSignalOrder: (req: OrderRequest) => { accepted: boolean; errors: string[] };
}

export const StrategiesView: React.FC<StrategiesViewProps> = ({
  state,
  onToggleStrategy,
  onToggleAutoExecute,
  onUpdateStrategy,
  onCreateStrategy,
  onDeleteStrategy,
  onExecuteSignalOrder,
}) => {
  const [selectedStrategyId, setSelectedStrategyId] = useState<StrategyId>('rhino_confluence');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState<StrategyTemplate>('CONFLUENCE');
  const [newTimeframe, setNewTimeframe] = useState<Timeframe>('1h');
  const [newRiskPct, setNewRiskPct] = useState(1.25);
  const [newSlMult, setNewSlMult] = useState(1.6);
  const [newTpMult, setNewTpMult] = useState(2.2);
  const [newRsiBuy, setNewRsiBuy] = useState(54);
  const [newRsiSell, setNewRsiSell] = useState(46);

  const [btSymbol, setBtSymbol] = useState<string>(state.selectedSymbol);
  const [btTimeframe, setBtTimeframe] = useState<Timeframe>('1h');
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(() => {
    const strat = state.strategies[0];
    const bars = state.candles[state.selectedSymbol]?.['1h'] ?? [];
    return strat && bars.length > 0
      ? runBacktest(strat, state.selectedSymbol, '1h', bars, state.startingBalance, state.riskSettings.feeRate)
      : null;
  });
  const [execMsg, setExecMsg] = useState<string | null>(null);

  const selectedStrategy =
    state.strategies.find((s) => s.id === selectedStrategyId) ?? state.strategies[0];

  const metrics = useMemo(() => computePerformanceMetrics(state), [state]);
  const strategyAttribution = useMemo(() => computeStrategyAttribution(state), [state]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreateStrategy({
      name: newName,
      subtitle: `${newTemplate.toLowerCase().replace('_', ' ')} strategy`,
      description: `Custom ${newTemplate.toLowerCase().replace('_', ' ')} ruleset running on ${newTimeframe} timeframe.`,
      template: newTemplate,
      timeframe: newTimeframe,
      riskPerTradePct: newRiskPct,
      stopLossAtrMult: newSlMult,
      takeProfitRrMult: newTpMult,
      rsiBuyThreshold: newRsiBuy,
      rsiSellThreshold: newRsiSell,
    });
    setNewName('');
    setShowCreateForm(false);
  };

  const handleRunBacktest = () => {
    const candles = state.candles[btSymbol]?.[btTimeframe] ?? [];
    if (candles.length === 0) return;
    const result = runBacktest(
      selectedStrategy,
      btSymbol,
      btTimeframe,
      candles,
      state.startingBalance,
      state.riskSettings.feeRate
    );
    setBacktestResult(result);
  };

  const activeSignals = state.signals.filter(
    (s) => s.strategyId === selectedStrategy.id && s.action !== 'HOLD'
  );

  const handlePaperExecuteSignal = (symbol: string, side: 'BUY' | 'SELL', sl: number, tp: number) => {
    const market = state.markets[symbol];
    if (!market) return;
    const qty = calculateSuggestedPositionSize({
      equity: metrics.totalEquity,
      riskPct: selectedStrategy.riskPerTradePct,
      entryPrice: market.price,
      stopLossPrice: sl,
      minQty: market.minQty,
    });
    const res = onExecuteSignalOrder({
      symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      stopLoss: sl,
      takeProfit: tp,
      strategyId: selectedStrategy.id,
    });
    setExecMsg(
      res.accepted
        ? `Executed ${selectedStrategy.name} signal: ${side} ${qty} ${market.baseAsset} @ ${formatAssetPrice(market.price)}`
        : res.errors[0] ?? 'Signal execution blocked by risk controls'
    );
  };

  return (
    <div className="space-y-6">
      {/* Header + Create Custom Strategy Action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#eef2f8]">Strategy Management &amp; Backtesting</h2>
          <p className="text-xs text-[#8190a8]">
            Create, configure, activate/deactivate, backtest, and monitor automated signal strategies
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="gold-button inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          {showCreateForm ? 'Close Builder' : 'Create Strategy'}
        </button>
      </div>

      {/* Create Strategy Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateSubmit} className="terminal-card p-5 border-[#d4af37]/60 space-y-4">
          <div className="text-sm font-bold text-[#f3dc8d]">New Quantitative Strategy</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-[#8190a8] mb-1">Strategy Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Gold Rhino Breakout"
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[#8190a8] mb-1">Rule Template</label>
              <select
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value as StrategyTemplate)}
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-[#eef2f8]"
              >
                <option value="CONFLUENCE">Multi-Indicator Confluence</option>
                <option value="MOMENTUM">Momentum Breakout</option>
                <option value="MEAN_REVERSION">Volatility Mean Reversion</option>
              </select>
            </div>
            <div>
              <label className="block text-[#8190a8] mb-1">Timeframe</label>
              <select
                value={newTimeframe}
                onChange={(e) => setNewTimeframe(e.target.value as Timeframe)}
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[#8190a8] mb-1">Risk Per Trade (%)</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                max="5"
                value={newRiskPct}
                onChange={(e) => setNewRiskPct(Number(e.target.value) || 1)}
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[#8190a8] mb-1">SL ATR Multiplier</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="5"
                value={newSlMult}
                onChange={(e) => setNewSlMult(Number(e.target.value) || 1.5)}
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[#8190a8] mb-1">TP R:R Multiplier</label>
              <input
                type="number"
                step="0.1"
                min="1"
                max="6"
                value={newTpMult}
                onChange={(e) => setNewTpMult(Number(e.target.value) || 2)}
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[#8190a8] mb-1">RSI Buy Threshold</label>
              <input
                type="number"
                min="20"
                max="75"
                value={newRsiBuy}
                onChange={(e) => setNewRsiBuy(Number(e.target.value) || 54)}
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[#8190a8] mb-1">RSI Sell Threshold</label>
              <input
                type="number"
                min="20"
                max="80"
                value={newRsiSell}
                onChange={(e) => setNewRsiSell(Number(e.target.value) || 46)}
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 font-mono text-[#eef2f8]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-lg border border-[#1b2940] text-xs text-[#b8c4d7]"
            >
              Cancel
            </button>
            <button type="submit" className="gold-button px-4 py-2 rounded-lg text-xs">
              Save &amp; Activate Strategy
            </button>
          </div>
        </form>
      )}

      {/* Strategy Cards Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {state.strategies.map((strat) => {
          const isSelected = strat.id === selectedStrategy.id;
          const actionableCount = state.signals.filter(
            (s) => s.strategyId === strat.id && s.action !== 'HOLD'
          ).length;

          return (
            <div
              key={strat.id}
              onClick={() => setSelectedStrategyId(strat.id)}
              className={`terminal-card p-4 cursor-pointer transition-colors ${
                isSelected ? 'border-[#d4af37]' : 'hover:border-[#2e4366]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-[#eef2f8]">{strat.name}</div>
                  <div className="text-xs text-[#8190a8] mt-0.5">{strat.subtitle}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {strat.isCustom && (
                    <button
                      type="button"
                      title="Delete custom strategy"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteStrategy(strat.id);
                      }}
                      className="p-1.5 rounded border border-[#1b2940] text-[#8190a8] hover:text-[#ff667a]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStrategy(strat.id);
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                      strat.enabled
                        ? 'bg-[#102b27] text-[#37d69a] border-[#1b5547]'
                        : 'bg-[#2a2415] text-[#f2bd58] border-[#5c4a22]'
                    }`}
                  >
                    {strat.enabled ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                    {strat.enabled ? 'ACTIVE' : 'PAUSED'}
                  </button>
                </div>
              </div>

              <p className="text-xs text-[#b8c4d7] mt-3 leading-relaxed">{strat.description}</p>

              <div className="mt-3 pt-3 border-t border-[#1b2940] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8190a8] font-mono tabular-nums">
                <span>TF: {strat.timeframe}</span>
                <span>Risk: {strat.riskPerTradePct}%</span>
                <span>R:R 1:{strat.takeProfitRrMult}</span>
                <span className="text-[#f3dc8d]">{actionableCount} signals</span>
              </div>

              <div className="mt-2.5 pt-2.5 border-t border-[#1b2940]/70 flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#8190a8]">Automated Paper Routing</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleAutoExecute(strat.id);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                    strat.autoExecutePaper
                      ? 'bg-[#211c0e] text-[#f3dc8d] border-[#d4af37]/70'
                      : 'bg-[#070c17] text-[#8190a8] border-[#1b2940] hover:text-[#eef2f8]'
                  }`}
                >
                  <Bot className="w-3 h-3" />
                  {strat.autoExecutePaper ? 'AUTO-PAPER ON' : 'AUTO-PAPER OFF'}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {/* Selected Strategy Rules + Parameter Tuning */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 terminal-card p-4 space-y-4">
          <div className="flex items-start justify-between gap-2 border-b border-[#1b2940] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[#f3dc8d]">{selectedStrategy.name} — Configuration</h3>
              <p className="text-xs text-[#8190a8]">Entry, exit, stop-loss, and risk parameters</p>
            </div>
            <button
              type="button"
              onClick={() => onToggleAutoExecute(selectedStrategy.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors shrink-0 ${
                selectedStrategy.autoExecutePaper
                  ? 'bg-[#211c0e] text-[#f3dc8d] border-[#d4af37]'
                  : 'bg-[#070c17] text-[#8190a8] border-[#1b2940] hover:text-[#eef2f8]'
              }`}
              title="Automatically route risk-sized simulated paper orders when this strategy emits signals"
            >
              <Bot className="w-3.5 h-3.5" />
              {selectedStrategy.autoExecutePaper ? 'Auto-Paper: ON' : 'Auto-Paper: OFF'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-[11px] text-[#8190a8] mb-1">Signal Timeframe</label>
              <select
                value={selectedStrategy.timeframe}
                onChange={(e) =>
                  onUpdateStrategy(selectedStrategy.id, { timeframe: e.target.value as Timeframe })
                }
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 font-mono text-[#eef2f8]"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#8190a8] mb-1">Risk / Trade (%)</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                max="5"
                value={selectedStrategy.riskPerTradePct}
                onChange={(e) =>
                  onUpdateStrategy(selectedStrategy.id, {
                    riskPerTradePct: Math.max(0.25, Math.min(5, Number(e.target.value) || 1)),
                  })
                }
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 font-mono tabular-nums text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#8190a8] mb-1">Stop-Loss (ATR ×)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="5"
                value={selectedStrategy.stopLossAtrMult}
                onChange={(e) =>
                  onUpdateStrategy(selectedStrategy.id, {
                    stopLossAtrMult: Math.max(0.5, Math.min(5, Number(e.target.value) || 1.5)),
                  })
                }
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 font-mono tabular-nums text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#8190a8] mb-1">Take-Profit (R:R ×)</label>
              <input
                type="number"
                step="0.1"
                min="1"
                max="6"
                value={selectedStrategy.takeProfitRrMult}
                onChange={(e) =>
                  onUpdateStrategy(selectedStrategy.id, {
                    takeProfitRrMult: Math.max(1, Math.min(6, Number(e.target.value) || 2)),
                  })
                }
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 font-mono tabular-nums text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#8190a8] mb-1">RSI Buy Threshold</label>
              <input
                type="number"
                min="20"
                max="75"
                value={selectedStrategy.params.rsiBuyThreshold}
                onChange={(e) =>
                  onUpdateStrategy(selectedStrategy.id, {
                    params: { rsiBuyThreshold: Number(e.target.value) || 50 },
                  })
                }
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 font-mono tabular-nums text-[#eef2f8]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#8190a8] mb-1">RSI Sell Threshold</label>
              <input
                type="number"
                min="20"
                max="80"
                value={selectedStrategy.params.rsiSellThreshold}
                onChange={(e) =>
                  onUpdateStrategy(selectedStrategy.id, {
                    params: { rsiSellThreshold: Number(e.target.value) || 50 },
                  })
                }
                className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 font-mono tabular-nums text-[#eef2f8]"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-[#1b2940]">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#37d69a] font-semibold mb-1">
                Entry Conditions
              </div>
              <ul className="space-y-1 text-xs text-[#b8c4d7]">
                {selectedStrategy.entryRules.map((rule, i) => (
                  <li key={i}>• {rule}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#f2bd58] font-semibold mb-1">
                Exit &amp; Risk Rules
              </div>
              <ul className="space-y-1 text-xs text-[#b8c4d7]">
                {selectedStrategy.exitRules.map((rule, i) => (
                  <li key={i}>• {rule}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Historical Backtester */}
        <div className="lg:col-span-7 terminal-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2940] pb-3">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-[#d4af37]" />
              <div>
                <h3 className="text-sm font-bold text-[#eef2f8]">Strategy Backtester</h3>
                <p className="text-xs text-[#8190a8]">
                  Replays simulated OHLCV bars with SL/TP &amp; fee modeling
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={btSymbol}
                onChange={(e) => setBtSymbol(e.target.value)}
                className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#eef2f8]"
              >
                {Object.values(state.markets).map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.symbol}
                  </option>
                ))}
              </select>
              <select
                value={btTimeframe}
                onChange={(e) => setBtTimeframe(e.target.value as Timeframe)}
                className="bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#eef2f8]"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleRunBacktest}
                className="gold-button px-3.5 py-1.5 rounded-lg text-xs"
              >
                Run Backtest
              </button>
            </div>
          </div>

          {backtestResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-2.5">
                  <div className="text-[10px] text-[#8190a8] uppercase">Net Return</div>
                  <div
                    className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
                      backtestResult.netProfit >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                    }`}
                  >
                    {formatPercent(backtestResult.totalReturnPct)}
                  </div>
                  <div className="text-[10px] text-[#8190a8] font-mono tabular-nums">
                    {formatCurrency(backtestResult.netProfit, true)}
                  </div>
                </div>
                <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-2.5">
                  <div className="text-[10px] text-[#8190a8] uppercase">Win Rate</div>
                  <div className="text-base font-bold font-mono tabular-nums text-[#eef2f8] mt-0.5">
                    {backtestResult.winRatePct}%
                  </div>
                  <div className="text-[10px] text-[#8190a8] tabular-nums">
                    {backtestResult.winningTrades}W / {backtestResult.losingTrades}L ({backtestResult.totalTrades} trades)
                  </div>
                </div>
                <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-2.5">
                  <div className="text-[10px] text-[#8190a8] uppercase">Profit Factor</div>
                  <div className="text-base font-bold font-mono tabular-nums text-[#f3dc8d] mt-0.5">
                    {backtestResult.profitFactor.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-[#8190a8]">
                    Avg Win {formatCurrency(backtestResult.averageWin)}
                  </div>
                </div>
                <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-2.5">
                  <div className="text-[10px] text-[#8190a8] uppercase">Max Drawdown</div>
                  <div className="text-base font-bold font-mono tabular-nums text-[#ff667a] mt-0.5">
                    -{backtestResult.maxDrawdownPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-[#8190a8]">{backtestResult.barsTested} bars tested</div>
                </div>
              </div>

              <EquityAreaChart
                points={backtestResult.equityCurve.map((pt) => ({
                  label: formatDateTime(pt.timestamp),
                  value: pt.equity,
                }))}
                height={180}
              />
            </div>
          )}
        </div>
      </section>

      {/* Actionable Signals Generated by Selected Strategy */}
      <section className="terminal-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#eef2f8]">
              Actionable Signals — {selectedStrategy.name}
            </h3>
            <p className="text-xs text-[#8190a8]">
              Click Execute Paper Signal to route a risk-sized paper order directly into the engine
            </p>
          </div>
          {execMsg && (
            <span className="text-xs font-mono text-[#f3dc8d] bg-[#211c0e] border border-[#594b22] px-3 py-1 rounded-lg">
              {execMsg}
            </span>
          )}
        </div>

        {activeSignals.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#8190a8]">
            No BUY or SELL triggers currently active for {selectedStrategy.name} on {selectedStrategy.timeframe}. Try advancing simulation ticks with STEP +1 or adjusting thresholds.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                  <th className="py-2.5 px-3">Instrument</th>
                  <th className="py-2.5 px-3">Signal</th>
                  <th className="py-2.5 px-3">Classification</th>
                  <th className="py-2.5 px-3 text-right">Strength</th>
                  <th className="py-2.5 px-3 text-right">Ref Price</th>
                  <th className="py-2.5 px-3 text-right">Suggested SL</th>
                  <th className="py-2.5 px-3 text-right">Suggested TP</th>
                  <th className="py-2.5 px-3">Rationale</th>
                  <th className="py-2.5 px-3 text-right">Paper Execution</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-[#1b2940]">
                {activeSignals.map((sig) => (
                  <tr key={`${sig.strategyId}-${sig.symbol}`} className="hover:bg-[#0e172a]/50">
                    <td className="py-2.5 px-3 font-bold text-[#eef2f8]">{sig.symbol}</td>
                    <td
                      className={`py-2.5 px-3 font-mono font-bold ${
                        isBuySignal(sig.action)
                          ? 'text-[#37d69a]'
                          : isSellSignal(sig.action)
                            ? 'text-[#ff667a]'
                            : 'text-[#8190a8]'
                      }`}
                    >
                      {(sig.action ?? 'HOLD').replace('_', ' ')}
                    </td>
                    <td className="py-2.5 px-3 text-[#b8c4d7]">
                      {(sig.category ?? 'NEUTRAL').replace('_', ' ')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#f3dc8d]">
                      {sig.confidence}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatAssetPrice(sig.price)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#ff667a]">
                      {formatAssetPrice(sig.suggestedStopLoss)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#37d69a]">
                      {formatAssetPrice(sig.suggestedTakeProfit)}
                    </td>
                    <td className="py-2.5 px-3 text-[#8190a8] max-w-[240px] truncate">
                      {(sig.reasons ?? []).join(' · ')}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          handlePaperExecuteSignal(
                            sig.symbol,
                            isBuySignal(sig.action) ? 'BUY' : 'SELL',
                            sig.suggestedStopLoss,
                            sig.suggestedTakeProfit
                          )
                        }
                        className="inline-flex items-center gap-1 gold-button px-2.5 py-1 rounded text-[11px]"
                      >
                        <Zap className="w-3 h-3" /> Execute Paper
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Live Paper Strategy Performance Attribution */}
      <section className="terminal-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2940] pb-3">
          <div>
            <h3 className="text-sm font-bold text-[#eef2f8]">Live Paper Strategy Performance Attribution</h3>
            <p className="text-xs text-[#8190a8]">
              Realized &amp; unrealized simulated P&amp;L tracked across automated strategies and manual trades
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#1b2940] text-[10px] uppercase tracking-wider text-[#71819a]">
                <th className="py-2.5 px-3">Strategy / Source</th>
                <th className="py-2.5 px-3">Mode</th>
                <th className="py-2.5 px-3 text-right">Open Pos</th>
                <th className="py-2.5 px-3 text-right">Closed Trades</th>
                <th className="py-2.5 px-3 text-right">Win Rate</th>
                <th className="py-2.5 px-3 text-right">Profit Factor</th>
                <th className="py-2.5 px-3 text-right">Unrealized P&amp;L</th>
                <th className="py-2.5 px-3 text-right">Realized P&amp;L</th>
                <th className="py-2.5 px-3 text-right">Total Net P&amp;L</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-[#1b2940]">
              {strategyAttribution.map((row) => (
                <tr key={row.strategyId} className="hover:bg-[#0e172a]/50">
                  <td className="py-2.5 px-3 font-semibold text-[#eef2f8]">{row.strategyName}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px]">
                    {row.strategyId === 'MANUAL' ? (
                      <span className="text-[#b8c4d7]">MANUAL</span>
                    ) : row.autoExecutePaper ? (
                      <span className="text-[#f3dc8d]">AUTO-PAPER</span>
                    ) : row.enabled ? (
                      <span className="text-[#37d69a]">SIGNAL ONLY</span>
                    ) : (
                      <span className="text-[#8190a8]">PAUSED</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {row.openPositionsCount}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {row.closedTradesCount} ({row.winningTrades}W/{row.losingTrades}L)
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {row.closedTradesCount > 0 ? `${row.winRatePct}%` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#f3dc8d]">
                    {row.closedTradesCount > 0 ? row.profitFactor.toFixed(2) : '—'}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                      row.unrealizedPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                    }`}
                  >
                    {formatCurrency(row.unrealizedPnl, true)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                      row.realizedPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                    }`}
                  >
                    {formatCurrency(row.realizedPnl, true)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                      row.netPnl >= 0 ? 'text-[#37d69a]' : 'text-[#ff667a]'
                    }`}
                  >
                    {formatCurrency(row.netPnl, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
