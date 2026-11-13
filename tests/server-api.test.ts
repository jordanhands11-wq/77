import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.ts';
import { placeOrder } from '../src/engine/tradingEngine.ts';
import type { TradingEngineState } from '../src/engine/types.ts';
import { PersistentStore } from '../src/server/db.ts';

function runTest(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => {
      console.log(`  PASS: ${name}`);
    })
    .catch((err) => {
      console.error(`  FAIL: ${name}`);
      throw err;
    });
}

async function main() {
  console.log('Running 77 TRADE IT Phase 3 Server, SQLite, Auth, Ledger & RBAC Tests...\n');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeit77-phase3-'));
  const store = new PersistentStore(tempDir);
  const app = createApp(store, { authRateLimitMax: 100, apiRateLimitMax: 500 });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  assert.ok(addr && typeof addr === 'object', 'Server must bind to an ephemeral port');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    let authToken = '';
    let userId = '';
    let secondToken = '';
    let secondUserId = '';
    let savedState: TradingEngineState | null = null;
    let verificationToken = '';

    await runTest('1. GET /api/health reports SQLite WAL engine, 14 tables & simulated lock', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json.ok, true);
      assert.equal(json.liveTradingAuthorized, false);
      assert.equal(json.mode, 'SIMULATED_PAPER_ONLY');
      assert.ok(Number(json.tablesCount) >= 14, 'Expected 14 SQLite relational tables');
      assert.ok(String(json.driver).includes('SQLite'));
    });

    await runTest('2. Registration creates TRADER, enforces validation, hides hash & logs ledger deposit', async () => {
      const badPass = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'short@test.local',
          password: '123',
          displayName: 'Short Pass',
        }),
      });
      assert.equal(badPass.status, 400);

      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'DeskLead@77tradeit.local',
          password: 'StrongPassword#77',
          displayName: 'Desk <Lead>',
          handle: 'desk_lead',
          startingBalance: 50_000,
          role: 'ADMIN', // Must be ignored! Public registration forces TRADER
        }),
      });
      assert.equal(res.status, 201);
      const data = (await res.json()) as {
        user: Record<string, unknown>;
        token: string;
        tradingState: TradingEngineState;
        verificationToken?: string;
      };
      assert.equal(data.user.email, 'desklead@77tradeit.local');
      assert.equal(data.user.displayName, 'Desk Lead'); // sanitized < >
      assert.equal(data.user.role, 'TRADER');
      assert.equal(data.user.emailVerified, false);
      assert.equal(data.user.passwordHash, undefined);
      assert.equal(data.user.passwordSalt, undefined);
      assert.ok(data.token.includes('.'));
      assert.ok(data.verificationToken);
      assert.equal(data.tradingState.availableCash, 50_000);
      authToken = data.token;
      userId = String(data.user.id);
      savedState = data.tradingState;
      verificationToken = data.verificationToken ?? '';

      // Duplicate email rejected
      const dup = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'desklead@77tradeit.local',
          password: 'AnotherPassword#99',
          displayName: 'Dup User',
        }),
      });
      assert.equal(dup.status, 400);

      // Ledger contains initial virtual deposit
      const ledgerRes = await fetch(`${baseUrl}/api/trading/ledger`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(ledgerRes.status, 200);
      const ledgerJson = (await ledgerRes.json()) as {
        transactions: Array<{ id: string; txType: string; amount: number; balanceAfter: number }>;
      };
      assert.equal(ledgerJson.transactions.length, 1);
      assert.equal(ledgerJson.transactions[0].txType, 'VIRTUAL_DEPOSIT');
      assert.equal(ledgerJson.transactions[0].amount, 50_000);
      assert.equal(ledgerJson.transactions[0].balanceAfter, 50_000);
    });

    await runTest('3. Email verification & Password reset + session revocation on logout/reset', async () => {
      // Verify email
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verificationToken }),
      });
      assert.equal(verifyRes.status, 200);
      const verifyJson = (await verifyRes.json()) as { user: { emailVerified: boolean } };
      assert.equal(verifyJson.user.emailVerified, true);

      // Logout revokes current token on server
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(logoutRes.status, 200);

      const revokedCheck = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const revokedJson = (await revokedCheck.json()) as { authenticated: boolean };
      assert.equal(revokedJson.authenticated, false);

      // Login again
      const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'desklead@77tradeit.local',
          password: 'WrongPassword',
        }),
      });
      assert.equal(badLogin.status, 401);

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'desklead@77tradeit.local',
          password: 'StrongPassword#77',
        }),
      });
      assert.equal(loginRes.status, 200);
      const loginJson = (await loginRes.json()) as { token: string };
      const preResetToken = loginJson.token;

      // Password reset flow
      const forgotRes = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'desklead@77tradeit.local' }),
      });
      assert.equal(forgotRes.status, 200);
      const forgotJson = (await forgotRes.json()) as { previewToken?: string };
      assert.ok(forgotJson.previewToken);

      const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: forgotJson.previewToken,
          newPassword: 'UpdatedPassword#77',
        }),
      });
      assert.equal(resetRes.status, 200);

      // Old session invalidated by password reset
      const oldSessionMe = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${preResetToken}` },
      });
      assert.equal(((await oldSessionMe.json()) as { authenticated: boolean }).authenticated, false);

      // Sign in with new password
      const loginNew = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'desklead@77tradeit.local',
          password: 'UpdatedPassword#77',
        }),
      });
      assert.equal(loginNew.status, 200);
      authToken = ((await loginNew.json()) as { token: string }).token;
    });

    await runTest('4. Profile updates & second user handle uniqueness', async () => {
      const reg2 = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'quant2@77tradeit.local',
          password: 'QuantPassword#77',
          displayName: 'Quant Two',
          handle: 'quant_two',
        }),
      });
      assert.equal(reg2.status, 201);
      const reg2Json = (await reg2.json()) as { token: string; user: { id: string } };
      secondToken = reg2Json.token;
      secondUserId = reg2Json.user.id;

      const conflict = await fetch(`${baseUrl}/api/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ handle: 'quant_two' }),
      });
      assert.equal(conflict.status, 400);

      const updated = await fetch(`${baseUrl}/api/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          displayName: 'Lead Portfolio Desk',
          handle: 'rhino_alpha',
          baseCurrency: 'GBP',
          bio: 'Momentum trader <script>',
          timezone: 'Europe/London',
        }),
      });
      assert.equal(updated.status, 200);
      const updatedJson = (await updated.json()) as {
        user: { displayName: string; handle: string; baseCurrency: string; bio: string; timezone: string };
      };
      assert.equal(updatedJson.user.displayName, 'Lead Portfolio Desk');
      assert.equal(updatedJson.user.handle, 'rhino_alpha');
      assert.equal(updatedJson.user.baseCurrency, 'GBP');
      assert.equal(updatedJson.user.bio, 'Momentum trader script');
      assert.equal(updatedJson.user.timezone, 'Europe/London');
    });

    await runTest('5. Trading state persistence & server-side reset', async () => {
      assert.ok(savedState);
      const executed = placeOrder(savedState, {
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1,
        strategyId: 'MANUAL',
      });
      assert.equal(executed.accepted, true);

      const putRes = await fetch(`${baseUrl}/api/trading/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ state: executed.state }),
      });
      assert.equal(putRes.status, 200);

      const getRes = await fetch(`${baseUrl}/api/trading/state`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(getRes.status, 200);
      const fetched = (await getRes.json()) as { state: TradingEngineState };
      assert.equal(fetched.state.positions.length, 1);

      const resetRes = await fetch(`${baseUrl}/api/trading/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ startingBalance: 250_000 }),
      });
      assert.equal(resetRes.status, 200);
      const resetJson = (await resetRes.json()) as { state: TradingEngineState };
      assert.equal(resetJson.state.availableCash, 250_000);
    });

    await runTest('6. Atomic order placement, duplicate idempotency guard (409) & order cancel', async () => {
      const mktRes = await fetch(`${baseUrl}/api/trading/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          symbol: 'ETHUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: 1,
          idempotencyKey: 'order-idem-1',
        }),
      });
      assert.equal(mktRes.status, 201);
      const mktJson = (await mktRes.json()) as {
        accepted: boolean;
        transactionId: string | null;
        state: TradingEngineState;
      };
      assert.equal(mktJson.accepted, true);
      assert.ok(mktJson.transactionId && mktJson.transactionId.startsWith('tx-'));

      // Replay exact same idempotencyKey -> 409 Conflict (duplicate prevention!)
      const dupOrder = await fetch(`${baseUrl}/api/trading/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          symbol: 'ETHUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: 1,
          idempotencyKey: 'order-idem-1',
        }),
      });
      assert.equal(dupOrder.status, 409);

      // Resting LIMIT order + server cancel
      const ethMark = mktJson.state.markets.ETHUSDT.price;
      const limitPrice = Number((ethMark * 0.75).toFixed(2));
      const limitRes = await fetch(`${baseUrl}/api/trading/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          symbol: 'ETHUSDT',
          side: 'BUY',
          type: 'LIMIT',
          quantity: 2,
          limitPrice,
        }),
      });
      assert.equal(limitRes.status, 201);
      const limitJson = (await limitRes.json()) as {
        order: { id: string; reservedCash: number };
        state: TradingEngineState;
      };

      const cancelRes = await fetch(`${baseUrl}/api/trading/orders/${limitJson.order.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(cancelRes.status, 200);
      const cancelJson = (await cancelRes.json()) as { state: TradingEngineState };
      assert.equal(cancelJson.state.openOrders.length, 0);
    });

    await runTest('7. Simulated deposits/withdrawals enforce ledger accuracy, idempotency & non-negative balance', async () => {
      const stateBefore = (
        (await (
          await fetch(`${baseUrl}/api/trading/state`, {
            headers: { Authorization: `Bearer ${authToken}` },
          })
        ).json()) as { state: TradingEngineState }
      ).state;

      const depRes = await fetch(`${baseUrl}/api/trading/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          direction: 'SIMULATED_DEPOSIT',
          amount: 10_000,
          note: 'Test desk top-up',
          idempotencyKey: 'trf-idem-1',
        }),
      });
      assert.equal(depRes.status, 201);
      const depJson = (await depRes.json()) as {
        ledgerEntry: { id: string; txType: string; balanceAfter: number };
        state: TradingEngineState;
      };
      assert.equal(depJson.ledgerEntry.txType, 'VIRTUAL_DEPOSIT');
      assert.ok(Math.abs(depJson.state.availableCash - (stateBefore.availableCash + 10_000)) < 0.01);

      // Duplicate deposit blocked -> 409
      const dupDep = await fetch(`${baseUrl}/api/trading/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          direction: 'SIMULATED_DEPOSIT',
          amount: 10_000,
          idempotencyKey: 'trf-idem-1',
        }),
      });
      assert.equal(dupDep.status, 409);

      // Excessive withdrawal rejected (prevents negative balance!)
      const badWithdraw = await fetch(`${baseUrl}/api/trading/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          direction: 'SIMULATED_WITHDRAWAL',
          amount: 999_999_999,
          idempotencyKey: 'trf-idem-bad',
        }),
      });
      assert.equal(badWithdraw.status, 400);
    });

    await runTest('8. Admin RBAC blocks ordinary users (403) and enables admin monitoring & governance', async () => {
      // Ordinary TRADER blocked from admin routes
      const unauthAdmin = await fetch(`${baseUrl}/api/admin/overview`);
      assert.equal(unauthAdmin.status, 401);

      const traderAdmin = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(traderAdmin.status, 403);

      const traderUsers = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { Authorization: `Bearer ${secondToken}` },
      });
      assert.equal(traderUsers.status, 403);

      // Promote first user to ADMIN via server-internal method (no public escalation route)
      store.setUserRoleInternal(userId, 'ADMIN');

      const adminOverview = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(adminOverview.status, 200);
      const ovJson = (await adminOverview.json()) as {
        overview: { usersTotal: number; ledgerTransactionsTotal: number };
      };
      assert.equal(ovJson.overview.usersTotal, 2);
      assert.ok(ovJson.overview.ledgerTransactionsTotal >= 4);

      // Verify UNAUTHORIZED_ADMIN_ACCESS was logged in admin_audit_logs
      const logsRes = await fetch(`${baseUrl}/api/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(logsRes.status, 200);
      const logsJson = (await logsRes.json()) as { logs: Array<{ action: string }> };
      assert.ok(logsJson.logs.some((l) => l.action === 'UNAUTHORIZED_ADMIN_ACCESS'));

      // Admin suspends secondUser -> revokes secondToken sessions & blocks login
      const suspRes = await fetch(`${baseUrl}/api/admin/users/${secondUserId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ status: 'SUSPENDED' }),
      });
      assert.equal(suspRes.status, 200);

      const suspMe = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${secondToken}` },
      });
      assert.equal(((await suspMe.json()) as { authenticated: boolean }).authenticated, false);

      const suspLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'quant2@77tradeit.local',
          password: 'QuantPassword#77',
        }),
      });
      assert.equal(suspLogin.status, 403);

      // Admin disables ADAUSDT -> order on ADAUSDT blocked with 400
      const disablePair = await fetch(`${baseUrl}/api/admin/pairs/ADAUSDT`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(disablePair.status, 200);

      const disabledOrder = await fetch(`${baseUrl}/api/trading/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          symbol: 'ADAUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: 100,
        }),
      });
      assert.equal(disabledOrder.status, 400);
    });

    await runTest('9. Corrupted PUT /api/trading/state & live exchange routing (403) + rate limiting (429)', async () => {
      const stateRes = await fetch(`${baseUrl}/api/trading/state`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const current = ((await stateRes.json()) as { state: TradingEngineState }).state;
      const putBad = await fetch(`${baseUrl}/api/trading/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ state: { ...current, availableCash: -500 } }),
      });
      assert.equal(putBad.status, 400);

      const liveRes = await fetch(`${baseUrl}/api/exchange/binance/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1 }),
      });
      assert.equal(liveRes.status, 403);

      // Dedicated rate-limited server instance verifies 429 enforcement
      const rlApp = createApp(store, { authRateLimitMax: 2, authRateLimitWindowMs: 60_000 });
      const rlServer = http.createServer(rlApp);
      await new Promise<void>((resolve) => rlServer.listen(0, '127.0.0.1', () => resolve()));
      const rlAddr = rlServer.address() as { port: number };
      const rlBase = `http://127.0.0.1:${rlAddr.port}`;
      try {
        await fetch(`${rlBase}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'x@y.z', password: 'wrong' }),
        });
        await fetch(`${rlBase}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'x@y.z', password: 'wrong' }),
        });
        const limited = await fetch(`${rlBase}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'x@y.z', password: 'wrong' }),
        });
        assert.equal(limited.status, 429);
      } finally {
        await new Promise<void>((resolve) => rlServer.close(() => resolve()));
      }
    });

    await runTest('10. Phase 4 live market proxy returns 24h quotes, multi-timeframe OHLCV, Coinbase fallback & honest 503 outage', async () => {
      const now = Date.now();
      const mockMarketFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes('data-api.binance.vision/api/v3/ticker/24hr')) {
          return new Response(
            JSON.stringify([
              {
                symbol: 'BTCUSDT',
                lastPrice: '71500.25',
                openPrice: '70000.00',
                highPrice: '72100.00',
                lowPrice: '69200.00',
                volume: '31245.50',
                priceChangePercent: '2.14',
                closeTime: now,
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('api.exchange.coinbase.com/products/ETH-USD/stats')) {
          return new Response(
            JSON.stringify({
              open: '3500.00',
              high: '3620.00',
              low: '3450.00',
              last: '3570.00',
              volume: '142300.25',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('data-api.binance.vision/api/v3/klines') && url.includes('symbol=BTCUSDT')) {
          const bars = Array.from({ length: 30 }, (_, i) => [
            now - (30 - i) * 3_600_000,
            '70000',
            '70500',
            '69800',
            String(70100 + i * 25),
            '950.5',
          ]);
          return new Response(JSON.stringify(bars), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Upstream error', { status: 502 });
      };

      const mktApp = createApp(store, { marketFetch: mockMarketFetch, apiRateLimitMax: 500 });
      const mktServer = http.createServer(mktApp);
      await new Promise<void>((resolve) => mktServer.listen(0, '127.0.0.1', () => resolve()));
      const mktAddr = mktServer.address() as { port: number };
      const mktBase = `http://127.0.0.1:${mktAddr.port}`;

      try {
        // Partial live + Coinbase fallback
        const qRes = await fetch(`${mktBase}/api/markets/live-quotes?symbols=BTCUSDT,ETHUSDT,SOLUSDT`);
        assert.equal(qRes.status, 200);
        const qJson = (await qRes.json()) as {
          status: string;
          quotes: Record<string, { price: number; volume24h: number; change24hPct: number; dataSource: string }>;
          unavailableSymbols: string[];
        };
        assert.equal(qJson.status, 'PARTIAL');
        assert.equal(qJson.quotes.BTCUSDT.price, 71500.25);
        assert.equal(qJson.quotes.BTCUSDT.volume24h, 31245.5);
        assert.equal(qJson.quotes.BTCUSDT.dataSource, 'LIVE_PUBLIC');
        assert.equal(qJson.quotes.ETHUSDT.price, 3570);
        assert.equal(qJson.quotes.ETHUSDT.change24hPct, 2);
        assert.ok(qJson.unavailableSymbols.includes('SOLUSDT'));

        // Historical OHLCV endpoint
        const cRes = await fetch(`${mktBase}/api/markets/candles?symbol=BTCUSDT&timeframe=1h&limit=30`);
        assert.equal(cRes.status, 200);
        const cJson = (await cRes.json()) as {
          ok: boolean;
          candles: Array<{ timestamp: number; close: number }>;
          dataSource: string;
        };
        assert.equal(cJson.ok, true);
        assert.equal(cJson.dataSource, 'LIVE_PUBLIC');
        assert.equal(cJson.candles.length, 30);

        // Invalid symbol & timeframe validation -> 400
        const badSym = await fetch(`${mktBase}/api/markets/candles?symbol=INVALID&timeframe=1h`);
        assert.equal(badSym.status, 400);
        const badTf = await fetch(`${mktBase}/api/markets/candles?symbol=BTCUSDT&timeframe=99m`);
        assert.equal(badTf.status, 400);

        // Complete outage -> honest 503 with ZERO fabricated prices/candles
        const failApp = createApp(store, {
          marketFetch: async () => new Response('Down', { status: 503 }),
          apiRateLimitMax: 500,
        });
        const failServer = http.createServer(failApp);
        await new Promise<void>((resolve) => failServer.listen(0, '127.0.0.1', () => resolve()));
        const failAddr = failServer.address() as { port: number };
        const failBase = `http://127.0.0.1:${failAddr.port}`;
        try {
          const outQuotes = await fetch(`${failBase}/api/markets/live-quotes?symbols=BTCUSDT`);
          assert.equal(outQuotes.status, 503);
          const outJson = (await outQuotes.json()) as { status: string; quotes: Record<string, unknown> };
          assert.equal(outJson.status, 'UNAVAILABLE');
          assert.deepEqual(outJson.quotes, {});

          const outCandles = await fetch(`${failBase}/api/markets/candles?symbol=BTCUSDT&timeframe=1h`);
          assert.equal(outCandles.status, 503);
          const outCJson = (await outCandles.json()) as { ok: boolean; candles: unknown[]; dataSource: string };
          assert.equal(outCJson.ok, false);
          assert.equal(outCJson.dataSource, 'UNAVAILABLE');
          assert.equal(outCJson.candles.length, 0);
        } finally {
          await new Promise<void>((resolve) => failServer.close(() => resolve()));
        }
      } finally {
        await new Promise<void>((resolve) => mktServer.close(() => resolve()));
      }
    });

    await runTest('11. Phase 5 individual user wallet, multi-asset balances & payment provider safety locks', async () => {
      // Unauthenticated wallet rejected
      const unauthWallet = await fetch(`${baseUrl}/api/wallet`);
      assert.equal(unauthWallet.status, 401);

      // Register fresh TRADER for clean Phase 5 wallet accounting assertions
      const reg3 = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'wallet_trader@77tradeit.local',
          password: 'WalletPassword#77',
          displayName: 'Wallet Trader',
          startingBalance: 25_000,
        }),
      });
      assert.equal(reg3.status, 201);
      const reg3Json = (await reg3.json()) as { token: string; user: { id: string } };
      const traderToken = reg3Json.token;

      const walletRes = await fetch(`${baseUrl}/api/wallet`, {
        headers: { Authorization: `Bearer ${traderToken}` },
      });
      assert.equal(walletRes.status, 200);
      const walletJson = (await walletRes.json()) as {
        mode: string;
        liveProcessingEnabled: boolean;
        wallet: {
          walletUid: string;
          availableUsdt: number;
          assets: Array<{ asset: string; availableBalance: number; reservedBalance: number }>;
        };
        providers: Array<{ id: string; status: string; liveProcessingEnabled: boolean }>;
      };
      assert.equal(walletJson.mode, 'SIMULATED_PAPER_ONLY');
      assert.equal(walletJson.liveProcessingEnabled, false);
      assert.ok(walletJson.wallet.walletUid.startsWith('WAL-77-'));
      assert.equal(walletJson.wallet.availableUsdt, 25_000);
      assert.ok(walletJson.wallet.assets.some((a) => a.asset === 'BTC'));
      assert.ok(walletJson.providers.some((p) => p.id === 'bank_sepa_ach_stub'));
      assert.ok(walletJson.providers.some((p) => p.id === 'card_gateway_stub'));
      assert.ok(walletJson.providers.every((p) => p.liveProcessingEnabled === false));

      // Live real-money charge route is locked (403)
      const liveCharge = await fetch(`${baseUrl}/api/payments/card_gateway_stub/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100 }),
      });
      assert.equal(liveCharge.status, 403);
    });

    await runTest('12. Phase 5 simulated deposits, duplicate credit prevention (409) & admin approval', async () => {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'wallet_trader@77tradeit.local',
          password: 'WalletPassword#77',
        }),
      });
      assert.equal(loginRes.status, 200);
      const traderToken = ((await loginRes.json()) as { token: string }).token;

      // Instant deposit below $10k threshold (USDT + BTC)
      const depUsdt = await fetch(`${baseUrl}/api/wallet/deposits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'USDT',
          amount: 2500,
          providerId: 'bank_sepa_ach_stub',
          note: 'Simulated wire top-up',
          idempotencyKey: 'p5-dep-usdt-1',
        }),
      });
      assert.equal(depUsdt.status, 201);
      const depUsdtJson = (await depUsdt.json()) as {
        transaction: { id: string; status: string; referenceCode: string; instruction: { disclaimer: string } };
        wallet: { availableUsdt: number };
      };
      assert.equal(depUsdtJson.transaction.status, 'COMPLETED');
      assert.ok(depUsdtJson.transaction.referenceCode.startsWith('DEP-77-'));
      assert.ok(depUsdtJson.transaction.instruction.disclaimer.includes('SIMULATED'));
      assert.equal(depUsdtJson.wallet.availableUsdt, 27_500);

      // Duplicate deposit with same idempotencyKey blocked (409) -> no double crediting
      const dupUsdt = await fetch(`${baseUrl}/api/wallet/deposits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'USDT',
          amount: 2500,
          providerId: 'bank_sepa_ach_stub',
          idempotencyKey: 'p5-dep-usdt-1',
        }),
      });
      assert.equal(dupUsdt.status, 409);

      // Deposit above $10k threshold -> enters PENDING (balance NOT credited yet)
      const pendingDep = await fetch(`${baseUrl}/api/wallet/deposits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'BTC',
          amount: 0.25,
          providerId: 'sim_sandbox_rail',
          idempotencyKey: 'p5-dep-btc-pending',
        }),
      });
      assert.equal(pendingDep.status, 201);
      const pendingDepJson = (await pendingDep.json()) as {
        transaction: { id: string; status: string };
        wallet: { assets: Array<{ asset: string; availableBalance: number }> };
      };
      assert.equal(pendingDepJson.transaction.status, 'PENDING');
      const btcBeforeApprove = pendingDepJson.wallet.assets.find((a) => a.asset === 'BTC');
      assert.equal(btcBeforeApprove?.availableBalance, 0);

      // TRADER blocked from approving own deposit (403)
      const traderApprove = await fetch(
        `${baseUrl}/api/admin/wallet/transactions/${pendingDepJson.transaction.id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${traderToken}`,
          },
          body: JSON.stringify({ decision: 'COMPLETE' }),
        }
      );
      assert.equal(traderApprove.status, 403);

      // ADMIN approves pending BTC deposit -> credits 0.25 BTC
      const adminApprove = await fetch(
        `${baseUrl}/api/admin/wallet/transactions/${pendingDepJson.transaction.id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ decision: 'COMPLETE' }),
        }
      );
      assert.equal(adminApprove.status, 200);
      assert.equal(((await adminApprove.json()) as { transaction: { status: string } }).transaction.status, 'COMPLETED');

      // Replay admin approval on already COMPLETED deposit blocked (400)
      const doubleApprove = await fetch(
        `${baseUrl}/api/admin/wallet/transactions/${pendingDepJson.transaction.id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ decision: 'COMPLETE' }),
        }
      );
      assert.equal(doubleApprove.status, 400);

      const walletAfterApprove = await fetch(`${baseUrl}/api/wallet`, {
        headers: { Authorization: `Bearer ${traderToken}` },
      });
      const btcAfter = (
        (await walletAfterApprove.json()) as {
          wallet: { assets: Array<{ asset: string; availableBalance: number }> };
        }
      ).wallet.assets.find((a) => a.asset === 'BTC');
      assert.equal(btcAfter?.availableBalance, 0.25);
    });

    await runTest('13. Phase 5 withdrawals enforce confirmation, double-spend locking, approval/rejection & ledger accuracy', async () => {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'wallet_trader@77tradeit.local',
          password: 'WalletPassword#77',
        }),
      });
      const traderToken = ((await loginRes.json()) as { token: string }).token;

      // Missing confirmation rejected (400)
      const unconfirmed = await fetch(`${baseUrl}/api/wallet/withdrawals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'USDT',
          amount: 500,
          destination: 'SIM-VAULT-1',
          confirmed: false,
        }),
      });
      assert.equal(unconfirmed.status, 400);

      // Insufficient funds rejected (400)
      const overdraw = await fetch(`${baseUrl}/api/wallet/withdrawals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'USDT',
          amount: 50_000,
          destination: 'SIM-VAULT-1',
          confirmed: true,
        }),
      });
      assert.equal(overdraw.status, 400);

      // Submit $15,000 USDT withdrawal (>= $10k threshold -> PENDING, locks $15,000 in reservedBalance)
      const wd1 = await fetch(`${baseUrl}/api/wallet/withdrawals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'USDT',
          amount: 15_000,
          destination: 'SIM-TREASURY-COLD-01',
          providerId: 'sim_sandbox_rail',
          confirmed: true,
          idempotencyKey: 'p5-wd-lock-1',
        }),
      });
      assert.equal(wd1.status, 201);
      const wd1Json = (await wd1.json()) as {
        transaction: { id: string; status: string };
        wallet: { availableUsdt: number; reservedUsdtForWithdrawals: number };
      };
      assert.equal(wd1Json.transaction.status, 'PENDING');
      assert.equal(wd1Json.wallet.availableUsdt, 12_500);
      assert.equal(wd1Json.wallet.reservedUsdtForWithdrawals, 15_000);

      // Double-spend attempt: try withdrawing another $15,000 while only $12,500 remains available -> 400!
      const doubleSpend = await fetch(`${baseUrl}/api/wallet/withdrawals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'USDT',
          amount: 15_000,
          destination: 'SIM-TREASURY-COLD-02',
          confirmed: true,
          idempotencyKey: 'p5-wd-lock-2',
        }),
      });
      assert.equal(doubleSpend.status, 400);

      // Admin moves withdrawal PENDING -> APPROVED -> REJECTED (refunds $15,000 back to $27,500)
      const stepApprove = await fetch(
        `${baseUrl}/api/admin/wallet/transactions/${wd1Json.transaction.id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ decision: 'APPROVE' }),
        }
      );
      assert.equal(stepApprove.status, 200);
      assert.equal(
        ((await stepApprove.json()) as { transaction: { status: string } }).transaction.status,
        'APPROVED'
      );

      const stepReject = await fetch(
        `${baseUrl}/api/admin/wallet/transactions/${wd1Json.transaction.id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ decision: 'REJECT', reason: 'Simulated compliance check test' }),
        }
      );
      assert.equal(stepReject.status, 200);
      assert.equal(
        ((await stepReject.json()) as { transaction: { status: string } }).transaction.status,
        'REJECTED'
      );

      const walletAfterReject = await fetch(`${baseUrl}/api/wallet`, {
        headers: { Authorization: `Bearer ${traderToken}` },
      });
      const wRejectJson = (await walletAfterReject.json()) as {
        wallet: { availableUsdt: number; reservedUsdtForWithdrawals: number };
      };
      assert.equal(wRejectJson.wallet.availableUsdt, 27_500);
      assert.equal(wRejectJson.wallet.reservedUsdtForWithdrawals, 0);

      // Submit a pending BTC withdrawal, then Admin completes it -> final BTC balance drops from 0.25 to 0.05
      const wdBtc = await fetch(`${baseUrl}/api/wallet/withdrawals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${traderToken}`,
        },
        body: JSON.stringify({
          asset: 'BTC',
          amount: 0.2,
          destination: 'SIM-BTC-TESTNET-ADDR',
          confirmed: true,
          idempotencyKey: 'p5-wd-btc-1',
        }),
      });
      assert.equal(wdBtc.status, 201);
      const wdBtcJson = (await wdBtc.json()) as { transaction: { id: string; status: string } };
      assert.equal(wdBtcJson.transaction.status, 'PENDING');

      const completeBtc = await fetch(
        `${baseUrl}/api/admin/wallet/transactions/${wdBtcJson.transaction.id}/review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ decision: 'COMPLETE' }),
        }
      );
      assert.equal(completeBtc.status, 200);
      assert.equal(
        ((await completeBtc.json()) as { transaction: { status: string } }).transaction.status,
        'COMPLETED'
      );

      const finalWalletRes = await fetch(`${baseUrl}/api/wallet`, {
        headers: { Authorization: `Bearer ${traderToken}` },
      });
      const finalWalletJson = (await finalWalletRes.json()) as {
        wallet: { assets: Array<{ asset: string; availableBalance: number; reservedBalance: number }> };
      };
      const finalBtc = finalWalletJson.wallet.assets.find((a) => a.asset === 'BTC');
      assert.equal(finalBtc?.availableBalance, 0.05);
      assert.equal(finalBtc?.reservedBalance, 0);

      // Verify ledger recorded all wallet events + alerts exist and can be resolved by admin
      const ledgerRes = await fetch(`${baseUrl}/api/trading/ledger`, {
        headers: { Authorization: `Bearer ${traderToken}` },
      });
      const ledgerJson = (await ledgerRes.json()) as {
        transactions: Array<{ txType: string; asset: string }>;
      };
      assert.ok(ledgerJson.transactions.some((t) => t.txType === 'WALLET_WITHDRAWAL_RESERVE'));
      assert.ok(ledgerJson.transactions.some((t) => t.txType === 'WALLET_WITHDRAWAL_RELEASE'));
      assert.ok(ledgerJson.transactions.some((t) => t.txType === 'SIMULATED_WITHDRAWAL' && t.asset === 'BTC'));

      const alertsRes = await fetch(`${baseUrl}/api/admin/wallet/alerts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(alertsRes.status, 200);
      const alertsJson = (await alertsRes.json()) as {
        alerts: Array<{ id: string; status: string; ruleCode: string }>;
      };
      assert.ok(alertsJson.alerts.length >= 2);
      const firstOpen = alertsJson.alerts.find((a) => a.status === 'OPEN');
      assert.ok(firstOpen);

      const resolveRes = await fetch(`${baseUrl}/api/admin/wallet/alerts/${firstOpen.id}/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert.equal(resolveRes.status, 200);
      assert.equal(((await resolveRes.json()) as { alert: { status: string } }).alert.status, 'RESOLVED');
    });

    console.log('\nAll Phase 3, Phase 4 & Phase 5 server, SQLite, auth, wallet, ledger, RBAC & live market tests passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

void main();

