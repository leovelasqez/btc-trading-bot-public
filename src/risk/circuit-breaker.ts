/**
 * Circuit Breaker — protección contra pérdidas excesivas
 * Pausa el bot si se alcanzan límites de riesgo
 */
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getBotState, updateBotState, logCircuitBreakerEvent } from '../storage/trade-logger.js';

export interface CircuitBreakerCheck {
  canTrade: boolean;
  reason?: string;
}

export async function checkCircuitBreaker(currentBalance: number): Promise<CircuitBreakerCheck> {
  const state = await getBotState();
  if (!state) {
    return { canTrade: false, reason: 'No se pudo leer bot_state' };
  }

  // 1. Bot pausado manualmente
  if (state.is_paused) {
    return { canTrade: false, reason: `Bot pausado: ${state.pause_reason ?? 'manual'}` };
  }

  // 2. Max trades por día
  const tradesToday = (state.daily_trades as number) ?? 0;
  if (tradesToday >= env.MAX_TRADES_PER_DAY) {
    await triggerCircuitBreaker(
      'max_trades_reached',
      { tradesToday, limit: env.MAX_TRADES_PER_DAY },
      (state.daily_pnl as number) ?? 0,
      tradesToday,
    );
    return { canTrade: false, reason: `Max trades/día alcanzado (${tradesToday}/${env.MAX_TRADES_PER_DAY})` };
  }

  // 3. Max pérdida diaria
  const dailyPnl = (state.daily_pnl as number) ?? 0;
  const startBalance = (state.start_of_day_balance as number) ?? currentBalance;
  const dailyLossPct = startBalance > 0 ? (Math.abs(Math.min(dailyPnl, 0)) / startBalance) * 100 : 0;

  if (dailyLossPct >= env.MAX_DAILY_LOSS_PCT) {
    await triggerCircuitBreaker(
      'max_daily_loss',
      { dailyPnl, dailyLossPct, limit: env.MAX_DAILY_LOSS_PCT },
      dailyPnl,
      tradesToday,
    );
    return { canTrade: false, reason: `Max pérdida diaria alcanzada (${dailyLossPct.toFixed(1)}% >= ${env.MAX_DAILY_LOSS_PCT}%)` };
  }

  return { canTrade: true };
}

async function triggerCircuitBreaker(
  eventType: string,
  details: Record<string, unknown>,
  dailyPnl: number,
  tradesToday: number,
): Promise<void> {
  logger.warn({ eventType, details }, 'Circuit breaker activado');

  await updateBotState({
    is_paused: true,
    pause_reason: eventType,
  });

  await logCircuitBreakerEvent(eventType, details, dailyPnl, tradesToday, true);
}

/**
 * Resetea stats diarios — llamar al inicio de cada día.
 * Preserva pausas manuales (manual_pause): solo despausa pausas automáticas.
 */
export async function resetDailyStats(currentBalance: number): Promise<void> {
  const state = await getBotState();
  const wasManuallyPaused = state?.pause_reason === 'manual_pause';

  await updateBotState({
    daily_pnl: 0,
    daily_trades: 0,
    daily_wins: 0,
    daily_losses: 0,
    start_of_day_balance: currentBalance,
    current_balance: currentBalance,
    // Preserve manual pauses — only clear automatic circuit breaker pauses
    ...(!wasManuallyPaused && { is_paused: false, pause_reason: null }),
  });

  logger.info(
    { balance: currentBalance, manualPausePreserved: wasManuallyPaused },
    'Stats diarios reseteados',
  );
}
