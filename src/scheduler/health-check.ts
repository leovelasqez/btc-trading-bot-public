/**
 * Health check — monitorea que el bot esté funcionando correctamente
 */
import { logger } from '../config/logger.js';
import { getBotState } from '../storage/trade-logger.js';
import { sendMessage } from '../notifications/telegram-bot.js';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutos sin análisis = alerta

export async function checkHealth(): Promise<void> {
  const state = await getBotState();
  if (!state) {
    logger.warn('No se pudo leer bot_state para health check');
    return;
  }

  const lastAnalysis = state.last_analysis_at as string | null;
  if (lastAnalysis) {
    const elapsed = Date.now() - new Date(lastAnalysis).getTime();
    if (elapsed > STALE_THRESHOLD_MS) {
      const minutes = Math.round(elapsed / 60000);
      logger.warn({ minutes }, 'Bot no ha analizado en mucho tiempo');
      await sendMessage(`⚠️ Health check: último análisis hace ${minutes} minutos`);
    }
  }

  const lastError = state.last_error as string | null;
  if (lastError) {
    const errorAt = state.last_error_at as string | null;
    if (errorAt) {
      const errorElapsed = Date.now() - new Date(errorAt).getTime();
      if (errorElapsed < 5 * 60 * 1000) {
        logger.warn({ error: lastError }, 'Error reciente detectado');
      }
    }
  }

  if (state.is_paused) {
    logger.info({ reason: state.pause_reason }, 'Bot está pausado');
  }
}
