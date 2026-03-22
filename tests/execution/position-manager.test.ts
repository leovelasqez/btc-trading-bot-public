/**
 * Tests para position-manager.ts
 * Fix #7: Validación de TP en ADJUST_TP
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ───

const ordersMocks = vi.hoisted(() => ({
  getOpenOrders: vi.fn(),
  cancelAllOrders: vi.fn(),
  placeStopLoss: vi.fn(),
  placeTakeProfit: vi.fn(),
  closePosition: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  getOpenTrade: vi.fn(),
  logPositionAdjustment: vi.fn(),
  logTradeClose: vi.fn(),
  updateTradeSLTP: vi.fn(),
  updateBotState: vi.fn(),
  getBotState: vi.fn(),
}));

const aiMocks = vi.hoisted(() => ({
  analyzePositionWithGemini: vi.fn(),
}));

const telegramMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({
  env: { CONFIDENCE_THRESHOLD: 80 },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/exchange/orders.js', () => ordersMocks);

vi.mock('../../src/ai/gemini-client.js', () => aiMocks);

vi.mock('../../src/storage/trade-logger.js', () => storageMocks);

vi.mock('../../src/notifications/telegram-bot.js', () => telegramMocks);

vi.mock('../../src/notifications/alert-formatter.js', () => ({
  formatPositionManagement: vi.fn(() => 'formatted-msg'),
}));

import { manageOpenPosition, validateAndGetSL } from '../../src/execution/position-manager.js';
import type { PositionData, TradeCosts } from '../../src/exchange/position-data.js';

// ─── Fixtures ───

const makePosition = (side: 'LONG' | 'SHORT', entryPrice = 85000): PositionData => ({
  side,
  entryPrice,
  quantity: 0.01,
  unrealizedPnl: 10,
  markPrice: side === 'LONG' ? 86000 : 84000,
  liquidationPrice: side === 'LONG' ? 70000 : 100000,
  leverage: 5,
});

const makeCosts = () => ({
  entryCommission: 0.5,
  exitCommission: 0.5,
  accumulatedFunding: 0.1,
  totalCosts: 1.1,
  netBreakeven: 85100,
});

const makeContext = (currentPrice = 86000) => ({
  currentPrice,
  timeframes: {},
  marketData: {},
  indicators: { tf_15m: { atr: 150 }, tf_1h: {}, tf_4h: {}, tf_1d: {} },
} as never);

const openTrade = {
  id: 'trade-uuid-123',
  side: 'LONG',
  entry_price: 85000,
  quantity: 0.01,
  stop_loss_price: 83000,
  take_profit_price: 88000,
  created_at: new Date().toISOString(),
};

const currentOrders = [
  { type: 'STOP_MARKET', stopPrice: 83000, orderId: 'sl-1' },
  { type: 'TAKE_PROFIT_MARKET', stopPrice: 88000, orderId: 'tp-1' },
];

const makeAdjustTP = (newTP: number, confidence = 85) => ({
  success: true,
  data: { action: 'ADJUST_TP', new_stop_loss: null, new_take_profit: newTP, confidence, reasoning: 'test' },
  rawText: '{}', latencyMs: 100, modelUsed: 'gemini-test',
});

// ─── Tests ───

describe('manageOpenPosition ADJUST_TP — Fix #7: validación de TP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getOpenTrade.mockResolvedValue(openTrade);
    ordersMocks.getOpenOrders.mockResolvedValue(currentOrders);
    ordersMocks.cancelAllOrders.mockResolvedValue(undefined);
    ordersMocks.placeStopLoss.mockResolvedValue({ orderId: 'sl-new', price: 83000 });
    ordersMocks.placeTakeProfit.mockResolvedValue({ orderId: 'tp-new', price: 90000 });
    storageMocks.updateTradeSLTP.mockResolvedValue(undefined);
    storageMocks.logPositionAdjustment.mockResolvedValue(undefined);
    telegramMocks.sendMessage.mockResolvedValue(undefined);
  });

  it('Fix #7: LONG + TP por debajo del precio → rechazado, placeTakeProfit NO llamado', async () => {
    // precio actual = 86000, TP sugerido = 84000 (inválido para LONG)
    aiMocks.analyzePositionWithGemini.mockResolvedValue(makeAdjustTP(84000));

    const result = await manageOpenPosition(
      makePosition('LONG', 85000), makeCosts(), makeContext(86000),
    );

    expect(ordersMocks.placeTakeProfit).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
  });

  it('Fix #7: LONG + TP por encima del precio → aceptado, placeTakeProfit llamado', async () => {
    // precio actual = 86000, TP = 90000 (válido para LONG)
    aiMocks.analyzePositionWithGemini.mockResolvedValue(makeAdjustTP(90000));

    const result = await manageOpenPosition(
      makePosition('LONG', 85000), makeCosts(), makeContext(86000),
    );

    expect(ordersMocks.placeTakeProfit).toHaveBeenCalledWith('sell', 0.01, 90000);
    expect(result.executed).toBe(true);
  });

  it('Fix #7: SHORT + TP por encima del precio → rechazado', async () => {
    // precio actual = 84000, TP = 86000 (inválido para SHORT)
    aiMocks.analyzePositionWithGemini.mockResolvedValue(makeAdjustTP(86000));

    const result = await manageOpenPosition(
      makePosition('SHORT', 85000), makeCosts(), makeContext(84000),
    );

    expect(ordersMocks.placeTakeProfit).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
  });

  it('Fix #7: SHORT + TP por debajo del precio → aceptado', async () => {
    // precio actual = 84000, TP = 82000 (válido para SHORT)
    aiMocks.analyzePositionWithGemini.mockResolvedValue(makeAdjustTP(82000));

    const result = await manageOpenPosition(
      makePosition('SHORT', 85000), makeCosts(), makeContext(84000),
    );

    expect(ordersMocks.placeTakeProfit).toHaveBeenCalledWith('buy', 0.01, 82000);
    expect(result.executed).toBe(true);
  });

  it('Fix #7: TP inválido → error de ejecución logueado en Supabase', async () => {
    aiMocks.analyzePositionWithGemini.mockResolvedValue(makeAdjustTP(84000)); // inválido LONG

    await manageOpenPosition(makePosition('LONG', 85000), makeCosts(), makeContext(86000));

    const logCall = storageMocks.logPositionAdjustment.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logCall?.['executionError']).toBeTruthy();
    expect(logCall?.['executed']).toBe(false);
  });

  it('HOLD: no toca ninguna orden', async () => {
    aiMocks.analyzePositionWithGemini.mockResolvedValue({
      success: true,
      data: { action: 'HOLD', new_stop_loss: null, new_take_profit: null, confidence: 70, reasoning: 'hold' },
      rawText: '{}', latencyMs: 100, modelUsed: 'gemini-test',
    });

    const result = await manageOpenPosition(makePosition('LONG'), makeCosts(), makeContext());

    expect(ordersMocks.cancelAllOrders).not.toHaveBeenCalled();
    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
    expect(ordersMocks.placeTakeProfit).not.toHaveBeenCalled();
    expect(result.action).toBe('HOLD');
  });

  it('sin trade en Supabase → HOLD sin llamar a Gemini', async () => {
    storageMocks.getOpenTrade.mockResolvedValue(null);

    const result = await manageOpenPosition(makePosition('LONG'), makeCosts(), makeContext());

    expect(result.action).toBe('HOLD');
    expect(aiMocks.analyzePositionWithGemini).not.toHaveBeenCalled();
  });

  it('confidence < umbral (50 < 55) → HOLD forzado, placeTakeProfit NO llamado', async () => {
    aiMocks.analyzePositionWithGemini.mockResolvedValue(makeAdjustTP(90000, 50));

    const result = await manageOpenPosition(makePosition('LONG'), makeCosts(), makeContext());

    expect(ordersMocks.placeTakeProfit).not.toHaveBeenCalled();
    expect(result.action).toBe('HOLD');
    expect(result.executed).toBe(false);
    expect(result.reason).toContain('50%');
  });

  it('confidence exactamente en umbral (55) → ejecuta normalmente', async () => {
    aiMocks.analyzePositionWithGemini.mockResolvedValue(makeAdjustTP(90000, 55));

    const result = await manageOpenPosition(makePosition('LONG'), makeCosts(), makeContext(86000));

    expect(ordersMocks.placeTakeProfit).toHaveBeenCalledWith('sell', 0.01, 90000);
    expect(result.executed).toBe(true);
  });
});

// ─── Tests para validateAndGetSL — Regla 3: buffer ATR ───

describe('validateAndGetSL — Regla 3: clamp con buffer 0.5×ATR', () => {
  const atr15m = 150; // ATR(15m) = $150, buffer = $75

  const makeSLData = (sl: number) => ({
    action: 'ADJUST_SL' as const,
    confidence: 90,
    reasoning: 'test',
    new_stop_loss: sl,
    new_take_profit: null,
    warnings: [],
  });

  const longPosition: PositionData = {
    side: 'LONG',
    entryPrice: 84000,
    quantity: 0.01,
    notional: 4200,
    unrealizedPnl: 5,
    markPrice: 84050,
    liquidationPrice: 70000,
    leverage: 5,
    marginUsed: 840,
  };

  const shortPosition: PositionData = {
    side: 'SHORT',
    entryPrice: 84000,
    quantity: 0.01,
    notional: 4200,
    unrealizedPnl: 5,
    markPrice: 83950,
    liquidationPrice: 100000,
    leverage: 5,
    marginUsed: 840,
  };

  // Costos: breakeven = 84100 para LONG, 83900 para SHORT
  const longCosts: TradeCosts = {
    entryCommission: 3.36,
    estimatedExitCommission: 3.36,
    accumulatedFunding: 0.5,
    totalCosts: 7.22,
    netBreakeven: 84100, // entry + costos
  };

  const shortCosts: TradeCosts = {
    entryCommission: 3.36,
    estimatedExitCommission: 3.36,
    accumulatedFunding: 0.5,
    totalCosts: 7.22,
    netBreakeven: 83900, // entry - costos
  };

  // ── LONG ──

  it('LONG: SL sugerido por encima del entry → clampea a entry - 0.5×ATR', () => {
    // Precio a favor ($84,050) pero no cubre costos (breakeven $84,100)
    // Gemini sugiere SL $84,080 → debe clampear a 84000 - 75 = $83,925
    const result = validateAndGetSL(
      makeSLData(84080), longPosition, longCosts, 84050, 83200, atr15m,
    );
    expect(result).toBe(83925);
  });

  it('LONG: SL sugerido exactamente en entry → clampea a entry - 0.5×ATR', () => {
    // Gemini sugiere $84,000 → aún supera maxAllowed ($83,925), clampea
    const result = validateAndGetSL(
      makeSLData(84000), longPosition, longCosts, 84050, 83200, atr15m,
    );
    expect(result).toBe(83925);
  });

  it('LONG: SL sugerido por debajo de entry - 0.5×ATR → pasa sin clampear', () => {
    // Gemini sugiere $83,900 → ya está por debajo de maxAllowed ($83,925), no clampea
    const result = validateAndGetSL(
      makeSLData(83900), longPosition, longCosts, 84050, 83200, atr15m,
    );
    expect(result).toBe(83900);
  });

  it('LONG: SL sugerido menor que SL actual → rechazado por regla 1', () => {
    // Gemini sugiere $83,100 → menor que SL actual $83,200
    const result = validateAndGetSL(
      makeSLData(83100), longPosition, longCosts, 84050, 83200, atr15m,
    );
    expect(result).toBeNull();
  });

  // ── SHORT ──

  it('SHORT: SL sugerido por debajo del entry → clampea a entry + 0.5×ATR', () => {
    // Precio a favor ($83,950) pero no cubre costos (breakeven $83,900)
    // Gemini sugiere SL $83,920 → debe clampear a 84000 + 75 = $84,075
    const result = validateAndGetSL(
      makeSLData(83920), shortPosition, shortCosts, 83950, 84800, atr15m,
    );
    expect(result).toBe(84075);
  });

  it('SHORT: SL sugerido exactamente en entry → clampea a entry + 0.5×ATR', () => {
    const result = validateAndGetSL(
      makeSLData(84000), shortPosition, shortCosts, 83950, 84800, atr15m,
    );
    expect(result).toBe(84075);
  });

  it('SHORT: SL sugerido por encima de entry + 0.5×ATR → pasa sin clampear', () => {
    // Gemini sugiere $84,100 → ya por encima de maxAllowed ($84,075), no clampea
    const result = validateAndGetSL(
      makeSLData(84100), shortPosition, shortCosts, 83950, 84800, atr15m,
    );
    expect(result).toBe(84100);
  });

  it('SHORT: SL sugerido mayor que SL actual → rechazado por regla 1', () => {
    // Gemini sugiere $84,900 → mayor que SL actual $84,800
    const result = validateAndGetSL(
      makeSLData(84900), shortPosition, shortCosts, 83950, 84800, atr15m,
    );
    expect(result).toBeNull();
  });

  // ── Sin ATR (fallback) ──

  it('LONG sin ATR: clampea a entry exacto (buffer = 0)', () => {
    const result = validateAndGetSL(
      makeSLData(84080), longPosition, longCosts, 84050, 83200, undefined,
    );
    expect(result).toBe(84000);
  });

  it('SHORT sin ATR: clampea a entry exacto (buffer = 0)', () => {
    const result = validateAndGetSL(
      makeSLData(83920), shortPosition, shortCosts, 83950, 84800, undefined,
    );
    expect(result).toBe(84000);
  });
});
