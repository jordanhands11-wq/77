import { roundToTick } from './marketData.ts';
import type {
  MarketInstrument,
  OrderBookLevel,
  OrderBookSnapshot,
  OrderRecord,
} from './types.ts';

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function buildSimulatedOrderBook(
  market: MarketInstrument,
  openOrders: OrderRecord[],
  tick: number,
  levelsCount = 8
): OrderBookSnapshot {
  const mid = Math.max(market.tickSize, market.price);
  const minStep = Math.max(market.tickSize, roundToTick(mid * 0.00035, market.tickSize));
  const halfSpread = Math.max(market.tickSize, roundToTick(minStep * 0.6, market.tickSize));
  const qtyDecimals = Math.max(0, Math.round(-Math.log10(market.minQty)));

  const symbolOrders = openOrders.filter(
    (o) => o.symbol === market.symbol && o.status === 'OPEN'
  );

  // Base level notional scales naturally with instrument volume and price
  const baseNotional = Math.max(2_500, Math.min(85_000, market.volume24h * 0.000018));

  const rawAsks: Omit<OrderBookLevel, 'cumulativeQty' | 'depthPct'>[] = [];
  const rawBids: Omit<OrderBookLevel, 'cumulativeQty' | 'depthPct'>[] = [];

  for (let i = 0; i < levelsCount; i++) {
    const askPrice = roundToTick(mid + halfSpread + i * minStep, market.tickSize);
    const bidPrice = Math.max(
      market.tickSize,
      roundToTick(mid - halfSpread - i * minStep, market.tickSize)
    );

    const askWeight = 0.55 + deterministicNoise(tick * 31 + i * 7 + mid * 0.01) * 1.45;
    const bidWeight = 0.55 + deterministicNoise(tick * 47 + i * 11 + mid * 0.02) * 1.45;

    const simAskQty = Number(
      Math.max(market.minQty, (baseNotional * (1 + i * 0.16) * askWeight) / askPrice).toFixed(
        qtyDecimals
      )
    );
    const simBidQty = Number(
      Math.max(market.minQty, (baseNotional * (1 + i * 0.16) * bidWeight) / bidPrice).toFixed(
        qtyDecimals
      )
    );

    const matchingUserAsks = symbolOrders.filter(
      (o) =>
        o.side === 'SELL' &&
        Math.abs(o.requestedPrice - askPrice) <= minStep * 0.55
    );
    const matchingUserBids = symbolOrders.filter(
      (o) =>
        o.side === 'BUY' &&
        Math.abs(o.requestedPrice - bidPrice) <= minStep * 0.55
    );

    const userAskQty = matchingUserAsks.reduce((s, o) => s + o.quantity, 0);
    const userBidQty = matchingUserBids.reduce((s, o) => s + o.quantity, 0);

    const totalAskQty = Number((simAskQty + userAskQty).toFixed(qtyDecimals));
    const totalBidQty = Number((simBidQty + userBidQty).toFixed(qtyDecimals));

    rawAsks.push({
      price: askPrice,
      quantity: totalAskQty,
      totalNotional: Number((totalAskQty * askPrice).toFixed(2)),
      userOrderCount: matchingUserAsks.length,
      userQty: Number(userAskQty.toFixed(qtyDecimals)),
    });

    rawBids.push({
      price: bidPrice,
      quantity: totalBidQty,
      totalNotional: Number((totalBidQty * bidPrice).toFixed(2)),
      userOrderCount: matchingUserBids.length,
      userQty: Number(userBidQty.toFixed(qtyDecimals)),
    });
  }

  // Merge any far-from-mid user resting limit orders so trader always sees their open orders
  for (const ord of symbolOrders) {
    const targetList = ord.side === 'SELL' ? rawAsks : rawBids;
    const alreadyMerged = targetList.some(
      (lvl) => Math.abs(lvl.price - ord.requestedPrice) <= minStep * 0.55
    );
    if (!alreadyMerged) {
      targetList.push({
        price: roundToTick(ord.requestedPrice, market.tickSize),
        quantity: ord.quantity,
        totalNotional: Number((ord.quantity * ord.requestedPrice).toFixed(2)),
        userOrderCount: 1,
        userQty: ord.quantity,
      });
    }
  }

  // Sort asks ascending (best ask nearest spread), bids descending (best bid nearest spread)
  rawAsks.sort((a, b) => a.price - b.price);
  rawBids.sort((a, b) => b.price - a.price);

  let askCum = 0;
  const asksWithCum = rawAsks.map((lvl) => {
    askCum = Number((askCum + lvl.quantity).toFixed(qtyDecimals));
    return { ...lvl, cumulativeQty: askCum };
  });

  let bidCum = 0;
  const bidsWithCum = rawBids.map((lvl) => {
    bidCum = Number((bidCum + lvl.quantity).toFixed(qtyDecimals));
    return { ...lvl, cumulativeQty: bidCum };
  });

  const maxCum = Math.max(1e-9, askCum, bidCum);

  const asks: OrderBookLevel[] = asksWithCum.map((lvl) => ({
    ...lvl,
    depthPct: Number(Math.min(100, (lvl.cumulativeQty / maxCum) * 100).toFixed(1)),
  }));

  const bids: OrderBookLevel[] = bidsWithCum.map((lvl) => ({
    ...lvl,
    depthPct: Number(Math.min(100, (lvl.cumulativeQty / maxCum) * 100).toFixed(1)),
  }));

  const bestAsk = asks[0]?.price ?? mid;
  const bestBid = bids[0]?.price ?? mid;
  const spread = Math.max(0, Number((bestAsk - bestBid).toFixed(6)));
  const spreadBps = mid > 0 ? Number(((spread / mid) * 10_000).toFixed(2)) : 0;
  const totalBookQty = askCum + bidCum;
  const bidImbalancePct =
    totalBookQty > 0 ? Number(((bidCum / totalBookQty) * 100).toFixed(1)) : 50;

  return {
    symbol: market.symbol,
    midPrice: mid,
    bestBid,
    bestAsk,
    spread,
    spreadBps,
    bidImbalancePct,
    asks: [...asks].reverse(), // Highest ask at top, best ask right above spread
    bids,
    dataSource: market.dataSource,
  };
}
