/**
 * Tests para startup-checks.ts
 * Fix #2: Detectar posición sin SL → SL de emergencia
 *         Detectar limit orders huérfanas → cancelar
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks ───

const positionMocks = vi.hoisted(() => ({
  fetchPositionData: vi.fn(),
}));

const ordersMocks = vi.hoisted(() => ({
  getOpenOrders: vi.fn(),
  getPendingLimitOrders: vi.fn(),
  placeStopLoss: vi.fn(),
  cancelAllOrders: vi.fn(),
}));

const telegramMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/exchange/position-data.js', () => positionMocks);

vi.mock('../../src/exchange/orders.js', () => ordersMocks);

vi.mock('../../src/notifications/telegram-bot.js', () => telegramMocks);

import { checkStartupSafety, ensurePositionHasSL } from '../../src/startup-checks.js';

// ─── Fixtures ───

const longPosition = {
  side: 'LONG' as const,
  entryPrice: 85000,
  quantity: 0.01,
  unrealizedPnl: 0,
  markPrice: 85000,
  liquidationPrice: 70000,
  leverage: 5,
};

const shortPosition = { ...longPosition, side: 'SHORT' as const };

const slOrder = { type: 'STOP_MARKET', stopPrice: 83000, orderId: 'sl-1' };
const tpOrder = { type: 'TAKE_PROFIT_MARKET', stopPrice: 88000, orderId: 'tp-1' };

// ─── Tests ───

describe('checkStartupSafety — Fix #2: seguridad al arrancar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordersMocks.placeStopLoss.mockResolvedValue({ orderId: 'sl-emergency' });
    ordersMocks.cancelAllOrders.mockResolvedValue(undefined);
    telegramMocks.sendMessage.mockResolvedValue(undefined);
  });

  // ── Posición sin SL ──

  it('Fix #2: LONG sin SL → placeStopLoss llamado al 3% por debajo de entrada', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(longPosition);
    ordersMocks.getOpenOrders.mockResolvedValue([]);

    await checkStartupSafety();

    expect(ordersMocks.placeStopLoss).toHaveBeenCalledOnce();
    const [side, qty, price] = ordersMocks.placeStopLoss.mock.calls[0] as [string, number, number];
    expect(side).toBe('sell');
    expect(qty).toBe(0.01);
    expect(price).toBeCloseTo(82450, 0); // 85000 * 0.97
  });

  it('Fix #2: SHORT sin SL → placeStopLoss llamado al 3% por encima de entrada', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(shortPosition);
    ordersMocks.getOpenOrders.mockResolvedValue([]);

    await checkStartupSafety();

    expect(ordersMocks.placeStopLoss).toHaveBeenCalledOnce();
    const [side, , price] = ordersMocks.placeStopLoss.mock.calls[0] as [string, number, number];
    expect(side).toBe('buy');
    expect(price).toBeCloseTo(87550, 0); // 85000 * 1.03
  });

  it('Fix #2: posición sin SL → notifica por Telegram', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(longPosition);
    ordersMocks.getOpenOrders.mockResolvedValue([]);

    await checkStartupSafety();

    expect(telegramMocks.sendMessage).toHaveBeenCalledOnce();
    const [msg] = telegramMocks.sendMessage.mock.calls[0] as [string];
    expect(msg).toContain('ARRANQUE');
    expect(msg).toContain('SL de emergencia');
  });

  // ── Posición CON SL ──

  it('posición con SL existente (STOP_MARKET) → NO coloca SL de emergencia', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(longPosition);
    ordersMocks.getOpenOrders.mockResolvedValue([slOrder, tpOrder]);

    await checkStartupSafety();

    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
    expect(telegramMocks.sendMessage).not.toHaveBeenCalled();
  });

  it('posición con SL alternativo (STOP) también reconocido', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(longPosition);
    ordersMocks.getOpenOrders.mockResolvedValue([{ type: 'STOP', stopPrice: 83000, orderId: 'sl-alt' }]);

    await checkStartupSafety();

    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
  });

  // ── Limit orders huérfanas ──

  it('Fix #2: sin posición + limit orders huérfanas → cancelAllOrders llamado', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(null);
    ordersMocks.getPendingLimitOrders.mockResolvedValue([{ orderId: 'orphan-1', price: 85000 }]);

    await checkStartupSafety();

    expect(ordersMocks.cancelAllOrders).toHaveBeenCalledOnce();
    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
  });

  it('sin posición + limit orders huérfanas → notifica por Telegram con cantidad', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(null);
    ordersMocks.getPendingLimitOrders.mockResolvedValue([{ orderId: 'o1' }, { orderId: 'o2' }]);

    await checkStartupSafety();

    expect(telegramMocks.sendMessage).toHaveBeenCalledOnce();
    const [msg] = telegramMocks.sendMessage.mock.calls[0] as [string];
    expect(msg).toContain('2');
    expect(msg).toContain('Canceladas');
  });

  // ── Estado limpio ──

  it('sin posición ni limit orders → no hace nada', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(null);
    ordersMocks.getPendingLimitOrders.mockResolvedValue([]);

    await checkStartupSafety();

    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
    expect(ordersMocks.cancelAllOrders).not.toHaveBeenCalled();
    expect(telegramMocks.sendMessage).not.toHaveBeenCalled();
  });

  // ── Resiliencia ──

  it('fetchPositionData lanza error → no propaga, arranque continúa', async () => {
    positionMocks.fetchPositionData.mockRejectedValue(new Error('Network error'));

    await expect(checkStartupSafety()).resolves.not.toThrow();
  });

  it('placeStopLoss falla → no propaga error', async () => {
    positionMocks.fetchPositionData.mockResolvedValue(longPosition);
    ordersMocks.getOpenOrders.mockResolvedValue([]);
    ordersMocks.placeStopLoss.mockRejectedValue(new Error('Order error'));

    await expect(checkStartupSafety()).resolves.not.toThrow();
  });
});

// ─── ensurePositionHasSL ───

describe('ensurePositionHasSL — red de seguridad en cada ciclo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordersMocks.placeStopLoss.mockResolvedValue({ orderId: 'sl-emergency' });
    telegramMocks.sendMessage.mockResolvedValue(undefined);
  });

  it('LONG sin SL → placeStopLoss llamado al 3% por debajo de entrada', async () => {
    ordersMocks.getOpenOrders.mockResolvedValue([]);

    await ensurePositionHasSL(longPosition);

    expect(ordersMocks.placeStopLoss).toHaveBeenCalledOnce();
    const [side, qty, price] = ordersMocks.placeStopLoss.mock.calls[0] as [string, number, number];
    expect(side).toBe('sell');
    expect(qty).toBe(0.01);
    expect(price).toBeCloseTo(82450, 0);
  });

  it('LONG con SL existente → NO coloca SL de emergencia', async () => {
    ordersMocks.getOpenOrders.mockResolvedValue([slOrder]);

    await ensurePositionHasSL(longPosition);

    expect(ordersMocks.placeStopLoss).not.toHaveBeenCalled();
    expect(telegramMocks.sendMessage).not.toHaveBeenCalled();
  });

  it('SHORT sin SL → placeStopLoss al 3% por encima de entrada', async () => {
    ordersMocks.getOpenOrders.mockResolvedValue([]);

    await ensurePositionHasSL(shortPosition);

    const [side, , price] = ordersMocks.placeStopLoss.mock.calls[0] as [string, number, number];
    expect(side).toBe('buy');
    expect(price).toBeCloseTo(87550, 0);
  });

  it('getOpenOrders lanza error → no propaga, ciclo continúa', async () => {
    ordersMocks.getOpenOrders.mockRejectedValue(new Error('Network error'));

    await expect(ensurePositionHasSL(longPosition)).resolves.not.toThrow();
  });
});
