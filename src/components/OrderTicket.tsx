import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  calculateSuggestedPositionSize,
  computePerformanceMetrics,
  validateOrder,
} from '../engine/risk.ts';
import type {
  OrderRequest,
  OrderSide,
  OrderType,
  TradingEngineState,
} from '../engine/types.ts';
import { formatAssetPrice, formatCurrency } from '../utils/format.ts';

interface OrderTicketProps {
  state: TradingEngineState;
  externalLimitSelection?: { price: number; side?: OrderSide; seq: number } | null;
  onSelectSymbol: (symbol: string) => void;
  onSubmitOrder: (req: OrderRequest) => { accepted: boolean; errors: string[] };
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  state,
  externalLimitSelection,
  onSelectSymbol,
  onSubmitOrder,
}) => {
  const market = state.markets[state.selectedSymbol] ?? Object.values(state.markets)[0];
  const metrics = useMemo(() => computePerformanceMetrics(state), [state]);

  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [quantityStr, setQuantityStr] = useState<string>('0.15');
  const [limitPriceStr, setLimitPriceStr] = useState<string>('');
  const [stopLossStr, setStopLossStr] = useState<string>('');
  const [takeProfitStr, setTakeProfitStr] = useState<string>('');
  const [confirmPending, setConfirmPending] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!externalLimitSelection) return;
    setOrderType('LIMIT');
    setLimitPriceStr(String(externalLimitSelection.price));
    if (externalLimitSelection.side) {
      setSide(externalLimitSelection.side);
    }
    setConfirmPending(false);
    setFeedback(null);
  }, [externalLimitSelection]);

  const quantity = Number(quantityStr) || 0;
  const limitPrice =
    orderType === 'LIMIT'
      ? limitPriceStr.trim()
        ? Number(limitPriceStr)
        : 0
      : undefined;
  const stopLoss = stopLossStr.trim() ? Number(stopLossStr) : undefined;
  const takeProfit = takeProfitStr.trim() ? Number(takeProfitStr) : undefined;

  const orderReq: OrderRequest = {
    symbol: market.symbol,
    side,
    type: orderType,
    quantity,
    limitPrice,
    stopLoss,
    takeProfit,
    strategyId: 'MANUAL',
  };

  const validation = useMemo(() => validateOrder(state, orderReq), [state, orderReq]);

  const applyAllocationPct = (pct: number) => {
    const refPrice = orderType === 'LIMIT' && limitPrice ? limitPrice : market.price;
    if (refPrice <= 0) return;

    const existingLong = state.positions.find(
      (p) => p.symbol === market.symbol && p.side === 'LONG'
    );
    if (side === 'SELL' && existingLong) {
      const qty = existingLong.quantity * pct;
      const decimals = Math.max(0, Math.round(-Math.log10(market.minQty)));
      setQuantityStr(qty.toFixed(decimals));
      setFeedback(null);
      return;
    }

    const usableCash = state.availableCash * pct;
    const rawQty = usableCash / (refPrice * (1 + state.riskSettings.feeRate));
    const decimals = Math.max(0, Math.round(-Math.log10(market.minQty)));
    setQuantityStr(Math.max(market.minQty, rawQty).toFixed(decimals));
    setFeedback(null);
  };

  const applyDefaultStops = () => {
    const refPrice = orderType === 'LIMIT' && limitPrice ? limitPrice : market.price;
    const slPct = state.riskSettings.defaultStopLossPct / 100;
    const tpPct = state.riskSettings.defaultTakeProfitPct / 100;
    const decimals = market.tickSize < 0.01 ? 4 : 2;
    if (side === 'BUY') {
      setStopLossStr((refPrice * (1 - slPct)).toFixed(decimals));
      setTakeProfitStr((refPrice * (1 + tpPct)).toFixed(decimals));
    } else {
      setStopLossStr((refPrice * (1 + slPct)).toFixed(decimals));
      setTakeProfitStr((refPrice * (1 - tpPct)).toFixed(decimals));
    }
  };

  const applyRiskSizing = () => {
    const refPrice = orderType === 'LIMIT' && limitPrice ? limitPrice : market.price;
    const sl =
      stopLoss ??
      (side === 'BUY'
        ? refPrice * (1 - state.riskSettings.defaultStopLossPct / 100)
        : refPrice * (1 + state.riskSettings.defaultStopLossPct / 100));
    if (!stopLossStr.trim()) {
      const decimals = market.tickSize < 0.01 ? 4 : 2;
      setStopLossStr(sl.toFixed(decimals));
    }
    const qty = calculateSuggestedPositionSize({
      equity: metrics.totalEquity,
      riskPct: state.riskSettings.maxRiskPerTradePct,
      entryPrice: refPrice,
      stopLossPrice: sl,
      minQty: market.minQty,
    });
    setQuantityStr(String(qty));
  };

  const handlePlaceClick = () => {
    setFeedback(null);
    if (!validation.valid) {
      setFeedback({ ok: false, text: validation.errors[0] });
      return;
    }
    if (state.riskSettings.requireConfirmation && !confirmPending) {
      setConfirmPending(true);
      return;
    }
    const res = onSubmitOrder(orderReq);
    setConfirmPending(false);
    if (res.accepted) {
      setFeedback({
        ok: true,
        text: `${orderType === 'MARKET' ? 'Executed' : 'Placed'} ${side} ${quantity} ${market.baseAsset}`,
      });
    } else {
      setFeedback({ ok: false, text: res.errors[0] ?? 'Order rejected by risk engine.' });
    }
  };

  return (
    <div className="terminal-card p-4 flex flex-col gap-3.5">
      <div className="flex items-center justify-between border-b border-[#1b2940] pb-3">
        <div>
          <h3 className="text-sm font-bold text-[#eef2f8]">Order Ticket</h3>
          <div className="text-[11px] text-[#8190a8]">
            Simulated paper execution ·{' '}
            <span className={market.dataSource === 'LIVE_PUBLIC' ? 'text-[#37d69a]' : 'text-[#8190a8]'}>
              {market.dataSource === 'LIVE_PUBLIC' ? 'Live market price ref' : 'Simulated price ref'}
            </span>
          </div>
        </div>
        <select
          aria-label="Select trading asset"
          value={market.symbol}
          onChange={(e) => {
            const nextSym = e.target.value;
            onSelectSymbol(nextSym);
            setConfirmPending(false);
            setLimitPriceStr(
              orderType === 'LIMIT' ? String(state.markets[nextSym]?.price ?? '') : ''
            );
            setStopLossStr('');
            setTakeProfitStr('');
            setFeedback(null);
          }}
          className="min-h-[38px] bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold text-[#f3dc8d] focus:outline-none focus:border-[#d4af37]"
        >
          {Object.values(state.markets).map((m) => (
            <option key={m.symbol} value={m.symbol}>
              {m.baseAsset}/{m.quoteAsset}
            </option>
          ))}
        </select>
      </div>

      {/* Buy / Sell Segmented Toggle */}
      <div className="grid grid-cols-2 gap-1.5 bg-[#070c17] p-1 rounded-lg border border-[#1b2940]">
        <button
          type="button"
          onClick={() => {
            setSide('BUY');
            setConfirmPending(false);
            setFeedback(null);
          }}
          className={`min-h-[40px] py-2 rounded-md text-xs font-bold tracking-wide transition-colors whitespace-nowrap shrink-0 ${
            side === 'BUY'
              ? 'bg-[#102b27] text-[#37d69a] border border-[#1b5547]'
              : 'text-[#8190a8] hover:text-[#eef2f8]'
          }`}
        >
          BUY / LONG
        </button>
        <button
          type="button"
          onClick={() => {
            setSide('SELL');
            setConfirmPending(false);
            setFeedback(null);
          }}
          className={`min-h-[40px] py-2 rounded-md text-xs font-bold tracking-wide transition-colors whitespace-nowrap shrink-0 ${
            side === 'SELL'
              ? 'bg-[#2c121a] text-[#ff667a] border border-[#5d2331]'
              : 'text-[#8190a8] hover:text-[#eef2f8]'
          }`}
        >
          SELL / SHORT
        </button>
      </div>

      {/* Order Type Toggle */}
      <div className="grid grid-cols-2 gap-1.5">
        {(['MARKET', 'LIMIT'] as OrderType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setOrderType(t);
              if (t === 'LIMIT' && !limitPriceStr) {
                setLimitPriceStr(String(market.price));
              }
              setConfirmPending(false);
            }}
            className={`min-h-[38px] py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
              orderType === t
                ? 'bg-[#211c0e] border-[#594b22] text-[#f3dc8d]'
                : 'bg-[#070c17] border-[#1b2940] text-[#8190a8] hover:text-[#eef2f8]'
            }`}
          >
            {t === 'MARKET' ? 'Market Order' : 'Limit Order'}
          </button>
        ))}
      </div>

      {/* Limit Price */}
      {orderType === 'LIMIT' && (
        <div>
          <label className="block text-[11px] text-[#8190a8] mb-1">
            Limit Price ({market.quoteAsset})
          </label>
          <input
            type="number"
            step={market.tickSize}
            value={limitPriceStr}
            onChange={(e) => {
              setLimitPriceStr(e.target.value);
              setConfirmPending(false);
            }}
            placeholder={String(market.price)}
            className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
          />
        </div>
      )}

      {/* Quantity */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-[#8190a8]">Quantity ({market.baseAsset})</span>
          <button
            type="button"
            onClick={applyRiskSizing}
            className="text-[#d4af37] hover:text-[#f3dc8d] font-medium"
          >
            Auto-size ({state.riskSettings.maxRiskPerTradePct}% risk)
          </button>
        </div>
        <input
          type="number"
          step={market.minQty}
          min={market.minQty}
          value={quantityStr}
          onChange={(e) => {
            setQuantityStr(e.target.value);
            setConfirmPending(false);
          }}
          className="w-full min-h-[42px] bg-[#070c17] border border-[#1b2940] rounded-lg px-3 py-2 text-sm font-mono tabular-nums text-[#eef2f8] focus:outline-none focus:border-[#d4af37]"
        />
        <div className="grid grid-cols-4 gap-1.5 mt-1.5">
          {[0.25, 0.5, 0.75, 1].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applyAllocationPct(pct)}
              className="py-1 rounded bg-[#070c17] border border-[#1b2940] text-[11px] font-mono text-[#b8c4d7] hover:border-[#d4af37]/60 hover:text-[#f3dc8d] transition-colors"
            >
              {pct * 100}%
            </button>
          ))}
        </div>
      </div>

      {/* Stop-Loss & Take-Profit */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#8190a8]">
            Risk Protection {state.riskSettings.requireStopLoss ? '(SL Required)' : '(Optional)'}
          </span>
          <button
            type="button"
            onClick={applyDefaultStops}
            className="text-[#d4af37] hover:text-[#f3dc8d] font-medium"
          >
            Apply SL/TP Preset
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-[#8190a8] mb-1">Stop-Loss</label>
            <input
              type="number"
              step={market.tickSize}
              value={stopLossStr}
              onChange={(e) => {
                setStopLossStr(e.target.value);
                setConfirmPending(false);
              }}
              placeholder="Price"
              className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#eef2f8] focus:outline-none focus:border-[#ff667a]"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[#8190a8] mb-1">Take-Profit</label>
            <input
              type="number"
              step={market.tickSize}
              value={takeProfitStr}
              onChange={(e) => {
                setTakeProfitStr(e.target.value);
                setConfirmPending(false);
              }}
              placeholder="Price"
              className="w-full bg-[#070c17] border border-[#1b2940] rounded-lg px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#eef2f8] focus:outline-none focus:border-[#37d69a]"
            />
          </div>
        </div>
      </div>

      {/* Order Summary Breakdown */}
      <div className="bg-[#070c17] border border-[#1b2940] rounded-lg p-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-[#8190a8]">Available Cash</span>
          <span className="font-mono tabular-nums text-[#eef2f8]">{formatCurrency(state.availableCash)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8190a8]">Est. Price</span>
          <span className="font-mono tabular-nums text-[#eef2f8]">{formatAssetPrice(validation.estimatedPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8190a8]">Order Value</span>
          <span className="font-mono tabular-nums text-[#eef2f8]">{formatCurrency(validation.estimatedNotional)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8190a8]">Est. Fee ({(state.riskSettings.feeRate * 100).toFixed(2)}%)</span>
          <span className="font-mono tabular-nums text-[#b8c4d7]">{formatCurrency(validation.estimatedFee)}</span>
        </div>
        <div className="flex justify-between pt-1.5 border-t border-[#1b2940]">
          <span className="text-[#8190a8]">Est. Risk / R:R</span>
          <span
            className={`font-mono tabular-nums font-semibold ${
              validation.estimatedRiskPct > state.riskSettings.maxRiskPerTradePct
                ? 'text-[#ff667a]'
                : 'text-[#37d69a]'
            }`}
          >
            {formatCurrency(validation.estimatedRiskAmount)} ({validation.estimatedRiskPct.toFixed(2)}%)
            {validation.estimatedRewardRiskRatio !== null
              ? ` · 1:${validation.estimatedRewardRiskRatio}`
              : ''}
          </span>
        </div>
      </div>

      {/* Live Validation Errors (Hard Risk Blocking) */}
      {!validation.valid && validation.errors.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-[#ff667a] bg-[#2c121a]/80 border border-[#5d2331] rounded-lg p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{validation.errors[0]}</span>
        </div>
      )}

      {/* Warnings */}
      {validation.warnings.length > 0 && validation.valid && (
        <div className="flex items-start gap-2 text-[11px] text-[#f2bd58] bg-[#2a2110]/70 border border-[#5c4a22] rounded-lg p-2.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{validation.warnings[0]}</span>
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-start gap-2 text-xs rounded-lg p-2.5 border ${
            feedback.ok
              ? 'bg-[#102b27]/70 border-[#1b5547] text-[#37d69a]'
              : 'bg-[#2c121a]/80 border-[#5d2331] text-[#ff667a]'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Confirmation or Submit */}
      {confirmPending ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[#f3dc8d] bg-[#211c0e] border border-[#594b22] rounded-lg p-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              Confirm {side} {quantity} {market.baseAsset} ({orderType}) for{' '}
              {formatCurrency(validation.estimatedNotional)}?
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmPending(false)}
              className="min-h-[42px] py-2 rounded-lg border border-[#1b2940] text-xs font-semibold text-[#b8c4d7] hover:text-[#eef2f8]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePlaceClick}
              className="gold-button min-h-[42px] py-2 rounded-lg text-xs font-bold"
            >
              Confirm Order
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!validation.valid}
          onClick={handlePlaceClick}
          className="gold-button w-full min-h-[44px] py-2.5 rounded-lg text-xs uppercase tracking-wider"
        >
          {side === 'BUY' ? `Place Buy ${market.baseAsset} Order` : `Place Sell ${market.baseAsset} Order`}
        </button>
      )}
    </div>
  );
};
