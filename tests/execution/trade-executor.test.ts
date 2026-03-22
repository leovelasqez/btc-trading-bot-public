/**
 * Tests para trade-executor.ts
 * Fix #1: Si placeStopLoss falla tras abrir posición MARKET → cerrar posición de emergencia
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ───

const ordersMocks = vi.hoisted(() => ({
  hasOpenPosition: vi.fn(),
  getBalance: vi.fn(),
  setMarginMode: vi.fn(),
  setLeverage: vi.fn(),
  cancelAllOrders: vi.fn(),
  openMarketOrder: vi.fn(),
  placeStopLoss: vi.fn(),
  placeTakeProfit: vi.fn(),
  closePosition: vi.fn(),
  placeLimitOrder: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  logTradeOpen: vi.fn(),
  updateBotState: vi.fn(),
}));

const telegramMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({
  env: { LEVERAGE: 5, CONFIDENCE_THRESHOLD: 70, MAX_POSITION_PCT: 100, TRADING_MODE: 'full-auto' },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/exchange/orders.js', () => ordersMocks);

vi.mock('../../src/risk/position-sizer.js', () => ({
  calculatePositionSize: vi.fn(() => ({
    quantity: 0.01,
    positionSizeUsdt: 1000,
    marginUsdt: 200,
  })),
}));

vi.mock('../../src/risk/circuit-breaker.js', () => ({
  checkCircuitBreaker: vi.fn(() => Promise.resolve({ canTrade: true })),
}));

vi.mock('../../src/storage/trade-logger.js', () => storageMocks);

vi.mock('../../src/notifications/telegram-bot.js', () => telegramMocks);

import { executeTrade } from '../../src/execution/trade-executor.js';

// ─── Fixtures ───

const makeSignal = (overrides: Record<string, unknown> = {}) => ({
  signal: 'LONG' as const,
  confidence: 80,
  reasoning: 'test signal',
  order_type: 'MARKET' as const,
  entry_price: 85000,
  stop_loss: 83000,
  take_profit: 88000,
  risk_reward_ratio: 1.5,
  key_levels: { support: [] as number[], resistance: [] as number[] },
  warnings: [] as string[],
  ...overrides,
});

const mockEntryOrder = { orderId: 'entry-123', price: 85000, quantity: 0.01, side: 'buy', status: 'filled' };
const mockSlOrder = { orderId: 'sl-123', price: 83000, quantity: 0.01, side: 'sell', status: 'open' };
const mockTpOrder = { orderId: 'tp-123', price: 88000, quantity: 0.01, side: 'sell', status: 'open' };
const mockCloseOrder = { orderId: 'close-123', price: 85100, quantity: 0.01, side: 'sell', status: 'filled' };

// ─── Tests ───

describe('executeTrade MARKET — Fix #1: SL rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordersMocks.hasOpenPosition.mockResolvedValue({ open: false });
    ordersMocks.getBalance.mockResolvedValue(1000);
    ordersMocks.setMarginMode.mockResolvedValue(undefined);
    ordersMocks.setLeverage.mockResolvedValue(undefined);
    ordersMocks.cancelAllOrders.mockResolvedValue(undefined);
    ordersMocks.openMarketOrder.mockResolvedValue(mockEntryOrder);
    ordersMocks.placeStopLoss.mockResolvedValue(mockSlOrder);
    ordersMocks.placeTakeProfit.mockResolvedValue(mockTpOrder);
    ordersMocks.closePosition.mockResolvedValue(mockCloseOrder);
    storageMocks.logTradeOpen.mockResolvedValue('trade-id-123');
    storageMocks.updateBotState.mockResolvedValue(undefined);
    telegramMocks.sendMessage.mockResolvedValue(undefined);
  });

  it('happy path: SL se coloca y trade registrado en Supabase', async () => {
    const result = await executeTrade(makeSignal(), 'decision-id');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.orderType).toBe('MARKET');
      expect(result.tradeId).toBe('trade-id-123');
    }
    expect(ordersMocks.placeStopLoss).toHaveBeenCalledOnce();
    expect(ordersMocks.closePosition).not.toHaveBeenCalled();
  });

  it('Fix #1: placeStopLoss falla → closePosition es llamado', async () => {
    ordersMocks.placeStopLoss.mockRejectedValue(new Error('Binance error: Invalid stop price'));

    const result = await executeTrade(makeSignal(), 'decision-id');

    expect(result.success).toBe(false);
    expect(ordersMocks.closePosition).toHaveBeenCalledOnce();
    expect(ordersMocks.closePosition).toHaveBeenCalledWith('LONG', 0.01);
  });

  it('Fix #1: closePosition llamado con dirección correcta para SHORT', async () => {
    ordersMocks.placeStopLoss.mockRejectedValue(new Error('SL error'));

    await executeTrade(makeSignal({ signal: 'SHORT' }), 'decision-id');

    expect(ordersMocks.closePosition).toHaveBeenCalledWith('SHORT', 0.01);
  });

  it('Fix #1: SL falla + closePosition también falla → alerta CRÍTICA por Telegram', async () => {
    ordersMocks.placeStopLoss.mockRejectedValue(new Error('SL error'));
    ordersMocks.closePosition.mockRejectedValue(new Error('Close error'));

    await executeTrade(makeSignal(), 'decision-id');

    const calls = telegramMocks.sendMessage.mock.calls as [string][];
    const hasCritical = calls.some(([msg]) =>
      msg.includes('CRÍTICO') || msg.includes('INTERVENCIÓN MANUAL'),
    );
    expect(hasCritical).toBe(true);
  });

  it('Fix #1: resultado failure con reason cuando SL falla', async () => {
    ordersMocks.placeStopLoss.mockRejectedValue(new Error('Precision error'));

    const result = await executeTrade(makeSignal(), 'decision-id');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('SL no colocado');
    }
  });

  it('SL falla → NO se registra trade en Supabase', async () => {
    ordersMocks.placeStopLoss.mockRejectedValue(new Error('SL error'));

    await executeTrade(makeSignal(), 'decision-id');

    expect(storageMocks.logTradeOpen).not.toHaveBeenCalled();
  });

  it('señal WAIT retorna failure sin abrir orden', async () => {
    const result = await executeTrade(makeSignal({ signal: 'WAIT' }), 'decision-id');

    expect(result.success).toBe(false);
    expect(ordersMocks.openMarketOrder).not.toHaveBeenCalled();
  });

  it('balance cero retorna failure sin abrir orden', async () => {
    ordersMocks.getBalance.mockResolvedValue(0);

    const result = await executeTrade(makeSignal(), 'decision-id');

    expect(result.success).toBe(false);
    expect(ordersMocks.openMarketOrder).not.toHaveBeenCalled();
  });

  it('posición ya abierta retorna failure sin abrir orden', async () => {
    ordersMocks.hasOpenPosition.mockResolvedValue({ open: true, side: 'LONG', size: 0.01 });

    const result = await executeTrade(makeSignal(), 'decision-id');

    expect(result.success).toBe(false);
    expect(ordersMocks.openMarketOrder).not.toHaveBeenCalled();
  });
});
