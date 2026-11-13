import { computeAllIndicators } from './indicators.ts';
import type {
  BacktestResult,
  BacktestTrade,
  Candle,
  IndicatorSeries,
  PositionSide,
  SignalAction,
  SignalCategory,
  StrategyConfig,
  StrategySignal,
  Timeframe,
} from './types.ts';

export const DEFAULT_STRATEGIES: StrategyConfig[] = [
  {
    id: 'rhino_confluence',
    name: '77 Rhino Confluence',
    subtitle: 'Multi-indicator confirmation',
    description:
      'Requires trend alignment between Fast and Slow EMA, RSI momentum confirmation, and MACD histogram directional agreement before emitting an entry signal.',
    template: 'CONFLUENCE',
    isCustom: false,
    enabled: true,
    autoExecutePaper: false,
    timeframe: '1h',
    riskPerTradePct: 1.5,
    stopLossAtrMult: 1.8,
    takeProfitRrMult: 2.2,
    params: {
      fastEma: 20,
      slowEma: 50,
      rsiPeriod: 14,
      rsiBuyThreshold: 52,
      rsiSellThreshold: 48,
      bbStdDev: 2,
    },
    entryRules: [
      'EMA 20 above EMA 50 for bullish trend (below for bearish)',
      'RSI(14) confirms momentum (> 52 long, < 48 short)',
      'MACD histogram aligns with directional bias',
    ],
    exitRules: [
      'Stop-loss anchored at 1.8× ATR(14)',
      'Take-profit targeted at 2.2× Risk/Reward',
      'Opposing confluence cross triggers early exit',
    ],
  },
  {
    id: 'momentum_trend_rider',
    name: 'Momentum Trend Rider',
    subtitle: 'Momentum breakout',
    description:
      'Captures directional expansion when price breaks above VWAP/Fast EMA with rising RSI momentum and above-average bar volume.',
    template: 'MOMENTUM',
    isCustom: false,
    enabled: false,
    autoExecutePaper: false,
    timeframe: '15m',
    riskPerTradePct: 1.25,
    stopLossAtrMult: 1.5,
    takeProfitRrMult: 2.5,
    params: {
      fastEma: 20,
      slowEma: 50,
      rsiPeriod: 14,
      rsiBuyThreshold: 56,
      rsiSellThreshold: 44,
      bbStdDev: 2,
    },
    entryRules: [
      'Close breaks above EMA 20 and VWAP (below for short)',
      'RSI(14) crosses momentum threshold (> 56 long, < 44 short)',
      'Bar volume exceeds 20-bar average volume',
    ],
    exitRules: [
      'Stop-loss at 1.5× ATR(14)',
      'Take-profit at 2.5× Risk/Reward',
      'Trailing close back through EMA 20',
    ],
  },
  {
    id: 'volatility_mean_reversion',
    name: 'Volatility Mean Reversion',
    subtitle: 'Range / volatility setup',
    description:
      'Targets statistical exhaustion extremes when price stretches outside Bollinger Bands with RSI oversold/overbought divergence.',
    template: 'MEAN_REVERSION',
    isCustom: false,
    enabled: false,
    autoExecutePaper: false,
    timeframe: '1h',
    riskPerTradePct: 1.0,
    stopLossAtrMult: 1.4,
    takeProfitRrMult: 1.8,
    params: {
      fastEma: 20,
      slowEma: 50,
      rsiPeriod: 14,
      rsiBuyThreshold: 34,
      rsiSellThreshold: 66,
      bbStdDev: 2,
    },
    entryRules: [
      'Price touches or closes beyond 2σ Bollinger Band',
      'RSI(14) reaches exhaustion (< 34 oversold, > 66 overbought)',
      'Reversal candle closes back toward band mean',
    ],
    exitRules: [
      'Mean reversion target at Bollinger Middle Band (SMA 20)',
      'Protective stop at 1.4× ATR(14)',
      'Take-profit at 1.8× Risk/Reward',
    ],
  },
];

export function isBuySignal(action: SignalAction): boolean {
  return action === 'BUY' || action === 'STRONG_BUY';
}

export function isSellSignal(action: SignalAction): boolean {
  return action === 'SELL' || action === 'STRONG_SELL';
}

export function evaluateStrategyAtBar(
  strategy: StrategyConfig,
  symbol: string,
  candles: Candle[],
  indicators: IndicatorSeries,
  index: number,
  dataSource: 'SIMULATED' | 'LIVE_PUBLIC' = 'SIMULATED'
): StrategySignal {
  const bar = candles[index];
  const prevIdx = Math.max(0, index - 1);
  const prevBar = candles[prevIdx];
  const emaFast = indicators.ema20[index];
  const prevEmaFast = indicators.ema20[prevIdx];
  const emaSlow = indicators.ema50[index];
  const prevEmaSlow = indicators.ema50[prevIdx];
  const rsi = indicators.rsi14[index];
  const macdHist = indicators.macdHistogram[index];
  const prevMacdHist = indicators.macdHistogram[prevIdx];
  const bbUpper = indicators.bbUpper[index];
  const bbLower = indicators.bbLower[index];
  const vwap = indicators.vwap[index];
  const volSma = indicators.volumeSma20[index];
  const atr = indicators.atr14[index] ?? bar.close * 0.012;

  let action: SignalAction = 'HOLD';
  let category: SignalCategory = 'NEUTRAL';
  let confidence = 48;
  const reasons: string[] = [];

  const template =
    strategy.template ??
    (strategy.id === 'momentum_trend_rider'
      ? 'MOMENTUM'
      : strategy.id === 'volatility_mean_reversion'
        ? 'MEAN_REVERSION'
        : 'CONFLUENCE');

  const emaCrossUp =
    emaFast !== null &&
    emaSlow !== null &&
    prevEmaFast !== null &&
    prevEmaSlow !== null &&
    prevEmaFast <= prevEmaSlow &&
    emaFast > emaSlow;

  const emaCrossDown =
    emaFast !== null &&
    emaSlow !== null &&
    prevEmaFast !== null &&
    prevEmaSlow !== null &&
    prevEmaFast >= prevEmaSlow &&
    emaFast < emaSlow;

  const macdCrossUp =
    macdHist !== null && prevMacdHist !== null && prevMacdHist <= 0 && macdHist > 0;
  const macdCrossDown =
    macdHist !== null && prevMacdHist !== null && prevMacdHist >= 0 && macdHist < 0;

  const volExpansion = volSma !== null ? bar.volume > volSma * 1.05 : false;

  if (template === 'CONFLUENCE') {
    if (emaFast !== null && emaSlow !== null && rsi !== null && macdHist !== null) {
      const bullTrend = emaFast > emaSlow && bar.close > emaFast;
      const bearTrend = emaFast < emaSlow && bar.close < emaFast;
      const bullMom = rsi >= strategy.params.rsiBuyThreshold && macdHist > 0;
      const bearMom = rsi <= strategy.params.rsiSellThreshold && macdHist < 0;

      if (bullTrend && bullMom) {
        confidence = Math.min(
          96,
          Math.round(70 + Math.min(16, rsi - 50) + (volExpansion ? 6 : 0) + (bar.close > prevBar.close ? 4 : 0))
        );
        action = confidence >= 82 ? 'STRONG_BUY' : 'BUY';
        category = emaCrossUp ? 'TREND_CHANGE' : macdCrossUp ? 'MOMENTUM_SHIFT' : 'CONFLUENCE';
        reasons.push(emaCrossUp ? 'Bullish EMA 20/50 trend crossover' : 'EMA 20 > EMA 50 bullish structure');
        reasons.push(`RSI(${strategy.params.rsiPeriod}) at ${rsi.toFixed(1)} confirms upward momentum`);
        reasons.push(macdCrossUp ? 'MACD histogram crossed positive' : 'MACD histogram positive');
      } else if (bearTrend && bearMom) {
        confidence = Math.min(
          96,
          Math.round(70 + Math.min(16, 50 - rsi) + (volExpansion ? 6 : 0) + (bar.close < prevBar.close ? 4 : 0))
        );
        action = confidence >= 82 ? 'STRONG_SELL' : 'SELL';
        category = emaCrossDown ? 'TREND_CHANGE' : macdCrossDown ? 'MOMENTUM_SHIFT' : 'CONFLUENCE';
        reasons.push(emaCrossDown ? 'Bearish EMA 20/50 trend crossover' : 'EMA 20 < EMA 50 bearish structure');
        reasons.push(`RSI(${strategy.params.rsiPeriod}) at ${rsi.toFixed(1)} confirms downward pressure`);
        reasons.push(macdCrossDown ? 'MACD histogram crossed negative' : 'MACD histogram negative');
      } else {
        if (emaCrossUp || emaCrossDown) {
          category = 'TREND_CHANGE';
          reasons.push(emaCrossUp ? 'Early bullish EMA cross detected — awaiting momentum' : 'Early bearish EMA cross detected — awaiting momentum');
        } else if (macdCrossUp || macdCrossDown) {
          category = 'MOMENTUM_SHIFT';
          reasons.push(macdCrossUp ? 'MACD momentum turning positive' : 'MACD momentum turning negative');
        } else {
          reasons.push('Confluence criteria partially aligned — awaiting full confirmation');
        }
      }
    } else {
      reasons.push('Warming up indicator window');
    }
  } else if (template === 'MOMENTUM') {
    if (emaFast !== null && rsi !== null && vwap !== null) {
      if (bar.close > emaFast && bar.close > vwap && rsi >= strategy.params.rsiBuyThreshold) {
        confidence = Math.min(95, Math.round(67 + (volExpansion ? 14 : 4) + Math.min(14, rsi - 55)));
        action = confidence >= 82 ? 'STRONG_BUY' : 'BUY';
        category = macdCrossUp ? 'MOMENTUM_SHIFT' : 'CONFLUENCE';
        reasons.push('Price holding above EMA 20 and VWAP');
        reasons.push(`RSI breakout (${rsi.toFixed(1)})`);
        if (volExpansion) reasons.push('Volume above 20-bar mean');
      } else if (bar.close < emaFast && bar.close < vwap && rsi <= strategy.params.rsiSellThreshold) {
        confidence = Math.min(95, Math.round(67 + (volExpansion ? 14 : 4) + Math.min(14, 45 - rsi)));
        action = confidence >= 82 ? 'STRONG_SELL' : 'SELL';
        category = macdCrossDown ? 'MOMENTUM_SHIFT' : 'CONFLUENCE';
        reasons.push('Price breaking below EMA 20 and VWAP');
        reasons.push(`RSI breakdown (${rsi.toFixed(1)})`);
        if (volExpansion) reasons.push('Sell volume expansion');
      } else {
        confidence = 45;
        reasons.push('No directional momentum breakout on current bar');
      }
    } else {
      reasons.push('Warming up momentum window');
    }
  } else if (template === 'MEAN_REVERSION') {
    if (bbUpper !== null && bbLower !== null && rsi !== null) {
      if (bar.low <= bbLower * 1.003 && rsi <= strategy.params.rsiBuyThreshold) {
        confidence = Math.min(94, Math.round(68 + Math.min(22, (strategy.params.rsiBuyThreshold - rsi) * 1.6)));
        action = confidence >= 82 ? 'STRONG_BUY' : 'BUY';
        category = 'REVERSAL';
        reasons.push('Potential bullish reversal at lower Bollinger Band (2σ)');
        reasons.push(`RSI oversold at ${rsi.toFixed(1)}`);
      } else if (bar.high >= bbUpper * 0.997 && rsi >= strategy.params.rsiSellThreshold) {
        confidence = Math.min(94, Math.round(68 + Math.min(22, (rsi - strategy.params.rsiSellThreshold) * 1.6)));
        action = confidence >= 82 ? 'STRONG_SELL' : 'SELL';
        category = 'REVERSAL';
        reasons.push('Potential bearish reversal at upper Bollinger Band (2σ)');
        reasons.push(`RSI overbought at ${rsi.toFixed(1)}`);
      } else {
        confidence = 44;
        reasons.push('Price trading inside 2σ Bollinger envelope');
      }
    } else {
      reasons.push('Warming up volatility bands');
    }
  }

  const slDistance = atr * strategy.stopLossAtrMult;
  const tpDistance = slDistance * strategy.takeProfitRrMult;
  const sellSide = isSellSignal(action);
  const suggestedStopLoss = sellSide
    ? Number((bar.close + slDistance).toFixed(4))
    : Number(Math.max(0.0001, bar.close - slDistance).toFixed(4));
  const suggestedTakeProfit = sellSide
    ? Number(Math.max(0.0001, bar.close - tpDistance).toFixed(4))
    : Number((bar.close + tpDistance).toFixed(4));

  const strengthLabel: StrategySignal['strengthLabel'] =
    action === 'STRONG_BUY' || action === 'STRONG_SELL'
      ? 'Strong'
      : action === 'BUY' || action === 'SELL'
        ? 'Moderate'
        : 'Neutral';

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    symbol,
    timeframe: strategy.timeframe,
    action,
    category,
    strengthLabel,
    confidence,
    price: bar.close,
    suggestedStopLoss,
    suggestedTakeProfit,
    reasons,
    timestamp: bar.timestamp,
    dataSource,
  };
}

export function generateLatestSignals(
  strategies: StrategyConfig[],
  candlesMap: Record<string, Record<Timeframe, Candle[]>>,
  symbols: string[],
  dataSourceBySymbol?: Record<string, 'SIMULATED' | 'LIVE_PUBLIC'>
): StrategySignal[] {
  const signals: StrategySignal[] = [];

  for (const strategy of strategies) {
    for (const symbol of symbols) {
      const candles = candlesMap[symbol]?.[strategy.timeframe];
      if (!candles || candles.length < 30) continue;
      const indicators = computeAllIndicators(candles, {
        fastEma: strategy.params.fastEma,
        slowEma: strategy.params.slowEma,
        rsiPeriod: strategy.params.rsiPeriod,
        bbStdDev: strategy.params.bbStdDev,
      });
      signals.push(
        evaluateStrategyAtBar(
          strategy,
          symbol,
          candles,
          indicators,
          candles.length - 1,
          dataSourceBySymbol?.[symbol] ?? 'SIMULATED'
        )
      );
    }
  }

  return signals;
}

export function runBacktest(
  strategy: StrategyConfig,
  symbol: string,
  timeframe: Timeframe,
  candles: Candle[],
  initialCapital = 100_000,
  feeRate = 0.001
): BacktestResult {
  const indicators = computeAllIndicators(candles, {
    fastEma: strategy.params.fastEma,
    slowEma: strategy.params.slowEma,
    rsiPeriod: strategy.params.rsiPeriod,
    bbStdDev: strategy.params.bbStdDev,
  });

  let cash = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;

  let activeTrade: {
    side: PositionSide;
    entryPrice: number;
    entryTime: number;
    quantity: number;
    stopLoss: number;
    takeProfit: number;
    entryFee: number;
  } | null = null;

  const trades: BacktestTrade[] = [];
  const equityCurve: { timestamp: number; equity: number }[] = [];

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];

    if (activeTrade) {
      let exitPrice: number | null = null;
      let exitReason: BacktestTrade['exitReason'] | null = null;

      if (activeTrade.side === 'LONG') {
        if (bar.low <= activeTrade.stopLoss) {
          exitPrice = activeTrade.stopLoss;
          exitReason = 'STOP_LOSS';
        } else if (bar.high >= activeTrade.takeProfit) {
          exitPrice = activeTrade.takeProfit;
          exitReason = 'TAKE_PROFIT';
        }
      } else {
        if (bar.high >= activeTrade.stopLoss) {
          exitPrice = activeTrade.stopLoss;
          exitReason = 'STOP_LOSS';
        } else if (bar.low <= activeTrade.takeProfit) {
          exitPrice = activeTrade.takeProfit;
          exitReason = 'TAKE_PROFIT';
        }
      }

      if (exitPrice !== null && exitReason !== null) {
        const exitFee = activeTrade.quantity * exitPrice * feeRate;
        const grossPnl =
          activeTrade.side === 'LONG'
            ? (exitPrice - activeTrade.entryPrice) * activeTrade.quantity
            : (activeTrade.entryPrice - exitPrice) * activeTrade.quantity;
        const netPnl = grossPnl - activeTrade.entryFee - exitFee;
        const entryValue = activeTrade.entryPrice * activeTrade.quantity;
        cash += entryValue + grossPnl - exitFee;

        trades.push({
          entryTime: activeTrade.entryTime,
          exitTime: bar.timestamp,
          side: activeTrade.side,
          entryPrice: activeTrade.entryPrice,
          exitPrice,
          quantity: activeTrade.quantity,
          pnl: Number(netPnl.toFixed(2)),
          returnPct: Number(((netPnl / entryValue) * 100).toFixed(2)),
          exitReason,
        });
        activeTrade = null;
      }
    }

    if (i >= 52) {
      const sig = evaluateStrategyAtBar(strategy, symbol, candles, indicators, i);

      if (
        activeTrade &&
        ((activeTrade.side === 'LONG' && isSellSignal(sig.action)) ||
          (activeTrade.side === 'SHORT' && isBuySignal(sig.action)))
      ) {
        const exitPrice = bar.close;
        const exitFee = activeTrade.quantity * exitPrice * feeRate;
        const grossPnl =
          activeTrade.side === 'LONG'
            ? (exitPrice - activeTrade.entryPrice) * activeTrade.quantity
            : (activeTrade.entryPrice - exitPrice) * activeTrade.quantity;
        const netPnl = grossPnl - activeTrade.entryFee - exitFee;
        const entryValue = activeTrade.entryPrice * activeTrade.quantity;
        cash += entryValue + grossPnl - exitFee;

        trades.push({
          entryTime: activeTrade.entryTime,
          exitTime: bar.timestamp,
          side: activeTrade.side,
          entryPrice: activeTrade.entryPrice,
          exitPrice,
          quantity: activeTrade.quantity,
          pnl: Number(netPnl.toFixed(2)),
          returnPct: Number(((netPnl / entryValue) * 100).toFixed(2)),
          exitReason: 'SIGNAL_EXIT',
        });
        activeTrade = null;
      }

      if (!activeTrade && (isBuySignal(sig.action) || isSellSignal(sig.action)) && i < candles.length - 1) {
        const side: PositionSide = isBuySignal(sig.action) ? 'LONG' : 'SHORT';
        const entryPrice = bar.close;
        const slDist = Math.abs(entryPrice - sig.suggestedStopLoss);
        const riskBudget = cash * (strategy.riskPerTradePct / 100);
        const riskBasedQty = slDist > 0 ? riskBudget / slDist : (cash * 0.15) / entryPrice;
        const maxAffordableQty = (cash * 0.45) / (entryPrice * (1 + feeRate));
        const quantity = Math.min(riskBasedQty, maxAffordableQty);

        if (quantity > 0 && entryPrice > 0) {
          const notional = quantity * entryPrice;
          const entryFee = notional * feeRate;
          if (notional + entryFee <= cash) {
            cash -= notional + entryFee;
            activeTrade = {
              side,
              entryPrice,
              entryTime: bar.timestamp,
              quantity,
              stopLoss: sig.suggestedStopLoss,
              takeProfit: sig.suggestedTakeProfit,
              entryFee,
            };
          }
        }
      }
    }

    const markValue = activeTrade
      ? activeTrade.entryPrice * activeTrade.quantity +
        (activeTrade.side === 'LONG'
          ? (bar.close - activeTrade.entryPrice) * activeTrade.quantity
          : (activeTrade.entryPrice - bar.close) * activeTrade.quantity)
      : 0;
    const equity = cash + markValue;
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    equityCurve.push({
      timestamp: bar.timestamp,
      equity: Number(equity.toFixed(2)),
    });
  }

  if (activeTrade && candles.length > 0) {
    const lastBar = candles[candles.length - 1];
    const exitPrice = lastBar.close;
    const exitFee = activeTrade.quantity * exitPrice * feeRate;
    const grossPnl =
      activeTrade.side === 'LONG'
        ? (exitPrice - activeTrade.entryPrice) * activeTrade.quantity
        : (activeTrade.entryPrice - exitPrice) * activeTrade.quantity;
    const netPnl = grossPnl - activeTrade.entryFee - exitFee;
    const entryValue = activeTrade.entryPrice * activeTrade.quantity;
    cash += entryValue + grossPnl - exitFee;

    trades.push({
      entryTime: activeTrade.entryTime,
      exitTime: lastBar.timestamp,
      side: activeTrade.side,
      entryPrice: activeTrade.entryPrice,
      exitPrice,
      quantity: activeTrade.quantity,
      pnl: Number(netPnl.toFixed(2)),
      returnPct: Number(((netPnl / entryValue) * 100).toFixed(2)),
      exitReason: 'END_OF_DATA',
    });
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1].equity = Number(cash.toFixed(2));
    }
  }

  const finalEquity = Number(cash.toFixed(2));
  const netProfit = Number((finalEquity - initialCapital).toFixed(2));
  const totalReturnPct = Number(((netProfit / initialCapital) * 100).toFixed(2));
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    symbol,
    timeframe,
    barsTested: candles.length,
    initialCapital,
    finalEquity,
    netProfit,
    totalReturnPct,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRatePct: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(1)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99.9 : 0,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    averageWin: wins.length > 0 ? Number((grossWin / wins.length).toFixed(2)) : 0,
    averageLoss: losses.length > 0 ? Number((grossLoss / losses.length).toFixed(2)) : 0,
    equityCurve,
    trades,
  };
}
