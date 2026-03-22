/**
 * Tests para el fill handler en analysis-cycle.ts
 * Fix #3: En fills parciales, usar qty real de Binance (hasOpenPosition) para SL/TP
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OrderFillEvent } from '../../src/exchange/user-data-ws.js';

// ─── Hoisted mocks ───

const wsMocks = vi.hoisted(() => {
  // Almacenamos el handler capturado en el closure del hoisted
  let _capturedHandler: ((fill: OrderFillEvent) => Promise<void>) | null = null;
  return {
    onOrderFill: vi.fn((handler: (fill: OrderFillEvent) => Promise<void>) => {
      _capturedHandler = handler;
    }),
    getCapturedHandler: () => _capturedHandler,
  };
});

const ordersMocks = vi.hoisted(() => ({
  hasOpenPosition: vi.fn(),
  getBalance: vi.fn(),
  cancelAllOrders: vi.fn(),
  placeStopLoss: vi.fn(),
  placeTakeProfit: vi.fn(),
  getOpenOrders: vi.fn(),
  getPendingLimitOrders: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  logTradeOpen: vi.fn(),
  updateBotState: vi.fn(),
  logAiDecision: vi.fn(),
  logSignal: vi.fn(),
  logTradeClose: vi.fn(),
  getOpenTrade: vi.fn(),
  getBotState: vi.fn(),
  updateTradeSLTP: vi.fn(),
}));

const telegramMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({
  env: { LEVERAGE: 5, TRADING_MODE: 'full-auto', BINANCE_TESTNET: 'false', CONFIDENCE_THRESHOLD: 70, ANALYSIS_INTERVAL_MINUTES: 30 },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/constants.js', () => ({ SYMBOL: 'BTC/USDT:USDT' }));

vi.mock('../../src/exchange/user-data-ws.js', () => ({
  onOrderFill: wsMocks.onOrderFill,
}));

vi.mock('../../src/exchange/orders.js', () => ordersMocks);

vi.mock('../../src/storage/trade-logger.js', () => storageMocks);

vi.mock('../../src/notifications/telegram-bot.js', () => telegramMocks);

vi.mock('../../src/notifications/alert-formatter.js', () => ({
  formatLimitOrderFilled: vi.fn(() => 'fill-msg'),
  formatSignalAlert: vi.fn(() => 'signal-msg'),
  formatError: vi.fn(() => 'error-msg'),
  formatLimitOrderManagement: vi.fn(() => 'limit-mgmt-msg'),
  formatWaitSignal: vi.fn(() => 'wait-msg'),
}));

vi.mock('../../src/exchange/binance.js', () => ({
  getExchange: vi.fn(() => ({ fetchTicker: vi.fn(), fetchMyTrades: vi.fn() })),
}));

vi.mock('../../src/exchange/candles.js', () => ({ fetchAllTimeframes: vi.fn() }));
vi.mock('../../src/exchange/market-data.js', () => ({ fetchAllMarketData: vi.fn() }));
vi.mock('../../src/exchange/position-data.js', () => ({ fetchPositionData: vi.fn(), fetchTradeCosts: vi.fn() }));
vi.mock('../../src/analysis/context-builder.js', () => ({ buildAnalysisPackage: vi.fn() }));
vi.mock('../../src/ai/gemini-client.js', () => ({
  analyzeWithGemini: vi.fn(),
  analyzeLimitOrderWithGemini: vi.fn(),
  analyzePositionWithGemini: vi.fn(),
}));
vi.mock('../../src/execution/trade-executor.js', () => ({ executeTrade: vi.fn() }));
vi.mock('../../src/execution/position-manager.js', () => ({ manageOpenPosition: vi.fn() }));
vi.mock('../../src/risk/circuit-breaker.js', () => ({ checkCircuitBreaker: vi.fn() }));

import { registerFillHandler, _setPendingOrderForTest } from '../../src/scheduler/analysis-cycle.js';

// ─── Fixtures ───

const pendingOrder = {
  orderId: 'limit-order-123',
  side: 'LONG' as const,
  limitPrice: 85000,
  quantity: 0.1,
  stopLoss: 83000,
  takeProfit: 88000,
  placedAt: new Date().toISOString(),
  aiDecisionId: 'decision-id-456',
};

const makeFullFill = (): OrderFillEvent => ({
  symbol: 'BTCUSDT',
  orderId: 'limit-order-123',
  side: 'BUY',
  orderType: 'LIMIT',
  orderStatus: 'FILLED',
  price: 85000,
  quantity: 0.1,
  filledQuantity: 0.1,  // cumulative qty = total order qty
  avgPrice: 85000,
  commission: 0.05,
  commissionAsset: 'USDT',
  tradeTime: Date.now(),
  isFullyFilled: true,
});

const makePartialFill = (cumulativeQty: number): OrderFillEvent => ({
  ...makeFullFill(),
  orderStatus: 'PARTIALLY_FILLED',
  filledQuantity: cumulativeQty,
  isFullyFilled: false,
});

// ─── Tests ───

describe('Fill handler — Fix #3: cantidad correcta en SL/TP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordersMocks.placeStopLoss.mockResolvedValue({ orderId: 'sl-new', price: 83000 });
    ordersMocks.placeTakeProfit.mockResolvedValue({ orderId: 'tp-new', price: 88000 });
    ordersMocks.cancelAllOrders.mockResolvedValue(undefined);
    ordersMocks.getBalance.mockResolvedValue(900);
    ordersMocks.hasOpenPosition.mockResolvedValue({ open: true, size: 0.1 });
    storageMocks.updateBotState.mockResolvedValue(undefined);
    storageMocks.logTradeOpen.mockResolvedValue('trade-id');
    telegramMocks.sendMessage.mockResolvedValue(undefined);

    // Registra y captura el handler
    registerFillHandler();
  });

  it('fill completo: hasOpenPosition NO es llamado', async () => {
    _setPendingOrderForTest(pendingOrder);
    await wsMocks.getCapturedHandler()!(makeFullFill());

    expect(ordersMocks.hasOpenPosition).not.toHaveBeenCalled();
  });

  it('fill completo: SL colocado con filledQuantity del evento WS', async () => {
    _setPendingOrderForTest(pendingOrder);
    await wsMocks.getCapturedHandler()!(makeFullFill());

    expect(ordersMocks.placeStopLoss).toHaveBeenCalledWith('sell', 0.1, 83000);
  });

  it('Fix #3: fill parcial → hasOpenPosition ES llamado para obtener qty real', async () => {
    _setPendingOrderForTest(pendingOrder);
    ordersMocks.hasOpenPosition.mockResolvedValue({ open: true, size: 0.06 });

    await wsMocks.getCapturedHandler()!(makePartialFill(0.05));

    expect(ordersMocks.hasOpenPosition).toHaveBeenCalledOnce();
  });

  it('Fix #3: fill parcial → SL colocado con qty REAL de Binance, no del evento', async () => {
    _setPendingOrderForTest(pendingOrder);
    // Evento reporta 0.05 cumulative, pero posición real = 0.06 (race condition)
    ordersMocks.hasOpenPosition.mockResolvedValue({ open: true, size: 0.06 });

    await wsMocks.getCapturedHandler()!(makePartialFill(0.05));

    // Debe usar 0.06 (real), NO 0.05 (evento)
    expect(ordersMocks.placeStopLoss).toHaveBeenCalledWith('sell', 0.06, 83000);
  });

  it('Fix #3: fill parcial → TP también colocado con qty real', async () => {
    _setPendingOrderForTest(pendingOrder);
    ordersMocks.hasOpenPosition.mockResolvedValue({ open: true, size: 0.06 });

    await wsMocks.getCapturedHandler()!(makePartialFill(0.05));

    expect(ordersMocks.placeTakeProfit).toHaveBeenCalledWith('sell', 0.06, 88000);
  });

  it('fill parcial: hasOpenPosition retorna open=false → fallback a filledQuantity del evento', async () => {
    _setPendingOrderForTest(pendingOrder);
    ordersMocks.hasOpenPosition.mockResolvedValue({ open: false }); // posición no detectada aún

    await wsMocks.getCapturedHandler()!(makePartialFill(0.05));

    expect(ordersMocks.placeStopLoss).toHaveBeenCalledWith('sell', 0.05, 83000);
  });

  it('fill sin pendingLimitOrder → silenciosamente ignorado', async () => {
    _setPendingOrderForTest(null);
    await wsMocks.getCapturedHandler()!(makeFullFill());

    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
    expect(storageMocks.logTradeOpen).not.toHaveBeenCalled();
  });

  it('fill de otra orden → ignorado', async () => {
    _setPendingOrderForTest(pendingOrder);
    const otherFill = { ...makeFullFill(), orderId: 'other-999' };

    await wsMocks.getCapturedHandler()!(otherFill);

    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
  });

  it('fill completo: trade registrado en Supabase con avgPrice y side correctos', async () => {
    _setPendingOrderForTest(pendingOrder);
    await wsMocks.getCapturedHandler()!(makeFullFill());

    expect(storageMocks.logTradeOpen).toHaveBeenCalledOnce();
    const logCall = storageMocks.logTradeOpen.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logCall?.['entryPrice']).toBe(85000);
    expect(logCall?.['side']).toBe('LONG');
    expect(logCall?.['quantity']).toBe(0.1);
  });

  it('fill completo: pendingLimitOrder limpiado después del fill', async () => {
    _setPendingOrderForTest(pendingOrder);
    await wsMocks.getCapturedHandler()!(makeFullFill());

    // Segundo fill del mismo orderId → ignorado (pendingLimitOrder ya fue limpiado)
    vi.clearAllMocks();
    ordersMocks.placeStopLoss.mockResolvedValue({ orderId: 'sl-new2' });
    await wsMocks.getCapturedHandler()!(makeFullFill());

    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
  });
});
