/**
 * Tests para intervalos dinámicos del scheduler
 *
 * Verifica que:
 * 1. getNextCycleIntervalMs() retorna el intervalo correcto según el estado del bot
 * 2. El scheduler (cron.ts) usa ese intervalo al programar el próximo ciclo
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ───

const wsMocks = vi.hoisted(() => ({
  onOrderFill: vi.fn(),
  onPositionClose: vi.fn(),
}));

const ordersMocks = vi.hoisted(() => ({
  hasOpenPosition: vi.fn(),
  getBalance: vi.fn().mockResolvedValue(100),
  cancelAllOrders: vi.fn(),
  placeStopLoss: vi.fn(),
  placeTakeProfit: vi.fn(),
  getOpenOrders: vi.fn().mockResolvedValue([]),
  getPendingLimitOrders: vi.fn().mockResolvedValue([]),
}));

const storageMocks = vi.hoisted(() => ({
  logTradeOpen: vi.fn(),
  updateBotState: vi.fn().mockResolvedValue(undefined),
  logAiDecision: vi.fn(),
  logSignal: vi.fn(),
  logTradeClose: vi.fn(),
  getOpenTrade: vi.fn().mockResolvedValue(null),
  getBotState: vi.fn().mockResolvedValue(null),
  updateTradeSLTP: vi.fn(),
}));

// ─── Module mocks ───

vi.mock('../../src/config/env.js', () => ({
  env: {
    LEVERAGE: 5,
    TRADING_MODE: 'full-auto',
    BINANCE_TESTNET: 'false',
    CONFIDENCE_THRESHOLD: 70,
    ANALYSIS_INTERVAL_MINUTES: 30,
  },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/constants.js', () => ({
  SYMBOL: 'BTC/USDT:USDT',
  ACTIVE_POSITION_INTERVAL_MINUTES: 15,
}));

vi.mock('../../src/exchange/user-data-ws.js', () => wsMocks);
vi.mock('../../src/exchange/orders.js', () => ordersMocks);
vi.mock('../../src/storage/trade-logger.js', () => storageMocks);

vi.mock('../../src/notifications/telegram-bot.js', () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/notifications/alert-formatter.js', () => ({
  formatSignalAlert: vi.fn(() => 'signal-msg'),
  formatError: vi.fn(() => 'error-msg'),
  formatWaitSignal: vi.fn(() => 'wait-msg'),
  formatLimitOrderManagement: vi.fn(() => 'limit-mgmt-msg'),
  formatLimitOrderFilled: vi.fn(() => 'fill-msg'),
  formatTradeClosed: vi.fn(() => 'closed-msg'),
}));

vi.mock('../../src/exchange/binance.js', () => ({
  getExchange: vi.fn(() => ({
    fetchTicker: vi.fn().mockResolvedValue({ last: 85000 }),
    fetchMyTrades: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../src/exchange/candles.js', () => ({
  fetchAllTimeframes: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/exchange/market-data.js', () => ({
  fetchAllMarketData: vi.fn().mockResolvedValue({
    markPremium: { lastFundingRate: 0 },
  }),
}));

vi.mock('../../src/exchange/position-data.js', () => ({
  fetchPositionData: vi.fn().mockResolvedValue(null),
  fetchTradeCosts: vi.fn(),
}));

vi.mock('../../src/analysis/context-builder.js', () => ({
  buildAnalysisPackage: vi.fn().mockReturnValue({
    context: { currentPrice: 85000 },
  }),
}));

vi.mock('../../src/ai/gemini-client.js', () => ({
  analyzeWithGemini: vi.fn().mockResolvedValue({
    success: true,
    data: { signal: 'WAIT', confidence: 40, reasoning: '', order_type: null, entry_price: null, stop_loss: null, take_profit: null, risk_reward_ratio: null, key_levels: { support: [], resistance: [] }, warnings: [] },
    latencyMs: 100,
    rawText: '',
    modelUsed: 'gemini-test',
  }),
  analyzeLimitOrderWithGemini: vi.fn(),
}));

vi.mock('../../src/execution/trade-executor.js', () => ({
  executeTrade: vi.fn(),
}));

vi.mock('../../src/execution/position-manager.js', () => ({
  manageOpenPosition: vi.fn().mockResolvedValue({ action: 'HOLD', executed: false }),
}));

vi.mock('../../src/risk/circuit-breaker.js', () => ({
  checkCircuitBreaker: vi.fn().mockResolvedValue({ canTrade: true }),
}));

vi.mock('../../src/startup-checks.js', () => ({
  ensurePositionHasSL: vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports (después de los mocks) ───

import {
  getNextCycleIntervalMs,
  _setPendingOrderForTest,
  _setLastCycleHadOpenPositionForTest,
} from '../../src/scheduler/analysis-cycle.js';

// ─── Fixture ───

const mockPendingOrder = {
  orderId: 'order-abc',
  side: 'LONG' as const,
  limitPrice: 85000,
  quantity: 0.1,
  stopLoss: 83000,
  takeProfit: 88000,
  placedAt: new Date().toISOString(),
  aiDecisionId: 'decision-123',
};

const INTERVAL_30_MIN = 30 * 60 * 1000;
const INTERVAL_15_MIN = 15 * 60 * 1000;

// ─── Tests ───

describe('getNextCycleIntervalMs — lógica de intervalos dinámicos', () => {
  beforeEach(() => {
    // Resetear estado del módulo antes de cada test
    _setPendingOrderForTest(null);
    _setLastCycleHadOpenPositionForTest(false);
  });

  it('retorna 30 min cuando no hay posición ni limit order', () => {
    const interval = getNextCycleIntervalMs();
    expect(interval).toBe(INTERVAL_30_MIN);
  });

  it('retorna 15 min cuando hay una limit order pendiente', () => {
    _setPendingOrderForTest(mockPendingOrder);
    const interval = getNextCycleIntervalMs();
    expect(interval).toBe(INTERVAL_15_MIN);
  });

  it('retorna 15 min cuando el último ciclo tuvo posición abierta', () => {
    _setLastCycleHadOpenPositionForTest(true);
    const interval = getNextCycleIntervalMs();
    expect(interval).toBe(INTERVAL_15_MIN);
  });

  it('retorna 15 min cuando hay posición Y limit order simultáneamente', () => {
    _setPendingOrderForTest(mockPendingOrder);
    _setLastCycleHadOpenPositionForTest(true);
    const interval = getNextCycleIntervalMs();
    expect(interval).toBe(INTERVAL_15_MIN);
  });

  it('vuelve a 30 min cuando se limpia la limit order (fill via WebSocket)', () => {
    _setPendingOrderForTest(mockPendingOrder);
    expect(getNextCycleIntervalMs()).toBe(INTERVAL_15_MIN);

    _setPendingOrderForTest(null);
    expect(getNextCycleIntervalMs()).toBe(INTERVAL_30_MIN);
  });

  it('vuelve a 30 min cuando la posición se cierra', () => {
    _setLastCycleHadOpenPositionForTest(true);
    expect(getNextCycleIntervalMs()).toBe(INTERVAL_15_MIN);

    _setLastCycleHadOpenPositionForTest(false);
    expect(getNextCycleIntervalMs()).toBe(INTERVAL_30_MIN);
  });
});

// ─── Tests del scheduler ───

describe('Scheduler — programación dinámica con setTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _setPendingOrderForTest(null);
    _setLastCycleHadOpenPositionForTest(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('programa el primer ciclo temprano y luego usa el intervalo base (30 min) sin estado activo', async () => {
    const { startScheduler, stopScheduler } = await import('../../src/scheduler/cron.js');

    startScheduler();

    // El primer ciclo corre inmediatamente (sin setTimeout)
    await Promise.resolve();
    // Esperar a que el primer ciclo async termine
    await vi.advanceTimersByTimeAsync(0);

    // Sin estado activo → próximo ciclo programado en 30 min
    // Avanzar 29 min — el ciclo NO debe haber corrido aún
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);

    const { checkCircuitBreaker } = await import('../../src/risk/circuit-breaker.js');
    const callCount = vi.mocked(checkCircuitBreaker).mock.calls.length;

    // Avanzar 1 min más → completa los 30 min → el ciclo corre
    await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
    await Promise.resolve();

    expect(vi.mocked(checkCircuitBreaker).mock.calls.length).toBeGreaterThan(callCount);

    stopScheduler();
  });

  it('usa intervalo de 15 min cuando hay una posición abierta al terminar el ciclo', async () => {
    const { fetchPositionData } = await import('../../src/exchange/position-data.js');
    const { manageOpenPosition } = await import('../../src/execution/position-manager.js');

    // Simular posición abierta en el primer ciclo
    vi.mocked(fetchPositionData).mockResolvedValueOnce({
      symbol: 'BTC/USDT:USDT',
      side: 'LONG',
      entryPrice: 85000,
      markPrice: 86000,
      unrealizedPnl: 100,
      leverage: 5,
      liquidationPrice: 70000,
      positionAmt: 0.1,
      notional: 8600,
      marginType: 'cross',
      isolatedMargin: 0,
    });

    const { startScheduler, stopScheduler } = await import('../../src/scheduler/cron.js');
    startScheduler();

    // Primer ciclo (inmediato): detecta posición → lastCycleHadOpenPosition = true
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    // Tras el primer ciclo con posición, el próximo debe ser en 15 min
    // A los 14 min el ciclo NO debe haber corrido aún
    const callsBefore = vi.mocked(manageOpenPosition).mock.calls.length;
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    await Promise.resolve();

    // Simular que la posición sigue abierta en el segundo ciclo
    vi.mocked(fetchPositionData).mockResolvedValueOnce({
      symbol: 'BTC/USDT:USDT',
      side: 'LONG',
      entryPrice: 85000,
      markPrice: 86500,
      unrealizedPnl: 150,
      leverage: 5,
      liquidationPrice: 70000,
      positionAmt: 0.1,
      notional: 8650,
      marginType: 'cross',
      isolatedMargin: 0,
    });

    // Al minuto 15 → el segundo ciclo debe correr
    await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
    await Promise.resolve();

    expect(vi.mocked(manageOpenPosition).mock.calls.length).toBeGreaterThan(callsBefore);

    stopScheduler();
  });

  it('usa intervalo de 15 min cuando hay una limit order pendiente', async () => {
    // El ciclo coloca una limit order → pendingLimitOrder se establece dentro del ciclo
    // → cuando scheduleNextCycle() se llama al final, getNextCycleIntervalMs() retorna 15 min
    const { analyzeWithGemini } = await import('../../src/ai/gemini-client.js');
    const { executeTrade } = await import('../../src/execution/trade-executor.js');
    const { logSignal, logAiDecision } = await import('../../src/storage/trade-logger.js');
    const { checkCircuitBreaker } = await import('../../src/risk/circuit-breaker.js');

    vi.mocked(logSignal).mockResolvedValueOnce('signal-id');
    vi.mocked(logAiDecision).mockResolvedValueOnce('decision-id');

    // Primer ciclo: Gemini recomienda LONG LIMIT con confidence 80
    vi.mocked(analyzeWithGemini).mockResolvedValueOnce({
      success: true,
      data: {
        signal: 'LONG',
        confidence: 80,
        reasoning: 'Tendencia alcista',
        order_type: 'LIMIT',
        entry_price: 85000,
        stop_loss: 83000,
        take_profit: 88000,
        risk_reward_ratio: 1.5,
        key_levels: { support: [], resistance: [] },
        warnings: [],
      },
      latencyMs: 100,
      rawText: '',
      modelUsed: 'gemini-test',
    });

    // executeTrade coloca la limit order exitosamente
    vi.mocked(executeTrade).mockResolvedValueOnce({
      success: true,
      orderType: 'LIMIT',
      orderId: 'limit-order-abc',
      side: 'LONG',
      limitPrice: 85000,
      quantity: 0.1,
      stopLoss: 83000,
      takeProfit: 88000,
    });

    const { startScheduler, stopScheduler } = await import('../../src/scheduler/cron.js');
    startScheduler();

    // Primer ciclo: coloca limit order → pendingLimitOrder != null al terminar
    // → scheduleNextCycle() llama getNextCycleIntervalMs() → retorna 15 min
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    const callsBefore = vi.mocked(checkCircuitBreaker).mock.calls.length;

    // A los 14 min el segundo ciclo NO debe haber corrido (intervalo es 15 min)
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    await Promise.resolve();
    expect(vi.mocked(checkCircuitBreaker).mock.calls.length).toBe(callsBefore);

    // Al minuto 15 sí debe correr
    await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
    await Promise.resolve();
    expect(vi.mocked(checkCircuitBreaker).mock.calls.length).toBeGreaterThan(callsBefore);

    stopScheduler();
  });

  it('stopScheduler cancela el timer y no corre más ciclos', async () => {
    const { checkCircuitBreaker } = await import('../../src/risk/circuit-breaker.js');
    const { startScheduler, stopScheduler } = await import('../../src/scheduler/cron.js');

    startScheduler();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    const callsAfterFirst = vi.mocked(checkCircuitBreaker).mock.calls.length;

    stopScheduler();

    // Avanzar más allá de cualquier intervalo — no deben correr más ciclos
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await Promise.resolve();

    expect(vi.mocked(checkCircuitBreaker).mock.calls.length).toBe(callsAfterFirst);
  });
});
