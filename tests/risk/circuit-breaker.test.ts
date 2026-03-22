/**
 * Tests para circuit-breaker.ts
 * Fix #6: resetDailyStats no debe desactivar pausas manuales
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (vi.mock se eleva al tope, las vars deben elevarse también) ───

const mocks = vi.hoisted(() => ({
  getBotState: vi.fn(),
  updateBotState: vi.fn(),
  logCircuitBreakerEvent: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({
  env: {
    MAX_TRADES_PER_DAY: 10,
    MAX_DAILY_LOSS_PCT: 5,
    LEVERAGE: 5,
  },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/storage/trade-logger.js', () => ({
  getBotState: mocks.getBotState,
  updateBotState: mocks.updateBotState,
  logCircuitBreakerEvent: mocks.logCircuitBreakerEvent,
}));

import { resetDailyStats } from '../../src/risk/circuit-breaker.js';

// ─── Tests ───

describe('resetDailyStats — Fix #6: preservar pausas manuales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateBotState.mockResolvedValue(undefined);
  });

  it('NO despausa cuando la pausa fue manual (/pause de Telegram)', async () => {
    mocks.getBotState.mockResolvedValue({
      is_paused: true,
      pause_reason: 'manual_pause',
    });

    await resetDailyStats(1000);

    const updateCall = mocks.updateBotState.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall).toBeDefined();
    // is_paused y pause_reason NO deben estar presentes en el update
    expect(updateCall['is_paused']).toBeUndefined();
    expect(updateCall['pause_reason']).toBeUndefined();
  });

  it('SÍ despausa cuando la pausa fue automática (max_trades_reached)', async () => {
    mocks.getBotState.mockResolvedValue({
      is_paused: true,
      pause_reason: 'max_trades_reached',
    });

    await resetDailyStats(1000);

    const updateCall = mocks.updateBotState.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall['is_paused']).toBe(false);
    expect(updateCall['pause_reason']).toBeNull();
  });

  it('SÍ despausa cuando la pausa fue automática (max_daily_loss)', async () => {
    mocks.getBotState.mockResolvedValue({
      is_paused: true,
      pause_reason: 'max_daily_loss',
    });

    await resetDailyStats(1000);

    const updateCall = mocks.updateBotState.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall['is_paused']).toBe(false);
    expect(updateCall['pause_reason']).toBeNull();
  });

  it('despausa correctamente cuando no había pausa activa', async () => {
    mocks.getBotState.mockResolvedValue({ is_paused: false, pause_reason: null });

    await resetDailyStats(1000);

    const updateCall = mocks.updateBotState.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall['is_paused']).toBe(false);
    expect(updateCall['pause_reason']).toBeNull();
  });

  it('siempre resetea los stats numéricos independientemente de la pausa', async () => {
    mocks.getBotState.mockResolvedValue({ is_paused: true, pause_reason: 'manual_pause' });

    await resetDailyStats(1234.56);

    const updateCall = mocks.updateBotState.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateCall['daily_pnl']).toBe(0);
    expect(updateCall['daily_trades']).toBe(0);
    expect(updateCall['daily_wins']).toBe(0);
    expect(updateCall['daily_losses']).toBe(0);
    expect(updateCall['start_of_day_balance']).toBe(1234.56);
    expect(updateCall['current_balance']).toBe(1234.56);
  });

  it('maneja getBotState null sin lanzar error', async () => {
    mocks.getBotState.mockResolvedValue(null);

    await expect(resetDailyStats(1000)).resolves.not.toThrow();
    expect(mocks.updateBotState).toHaveBeenCalled();
  });
});
