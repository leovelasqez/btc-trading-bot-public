/**
 * Scheduler principal — ejecuta ciclos de análisis con intervalos dinámicos.
 * Usa setTimeout recursivo en lugar de node-cron para ajustar el intervalo
 * entre ciclos según el estado del bot (posición abierta, limit order pendiente).
 */
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runAnalysisCycle, getNextCycleIntervalMs } from './analysis-cycle.js';

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let stopped = false;

function scheduleNextCycle(): void {
  if (stopped) return;

  const intervalMs = getNextCycleIntervalMs();
  const intervalMinutes = Math.round(intervalMs / 60000);

  logger.info({ nextIn: `${intervalMinutes}m` }, 'Próximo ciclo programado');

  schedulerTimer = setTimeout(async () => {
    schedulerTimer = null;

    if (stopped) return;

    if (isRunning) {
      // No debería ocurrir (el ciclo anterior siempre termina antes de programar el siguiente),
      // pero como defensa en profundidad se reintenta en 60s.
      logger.warn('Ciclo anterior todavía en ejecución — reintentando en 60s');
      schedulerTimer = setTimeout(scheduleNextCycle, 60_000);
      return;
    }

    isRunning = true;
    try {
      await runAnalysisCycle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error: msg }, 'Error inesperado en ciclo de análisis');
    } finally {
      isRunning = false;
    }

    // Programar el siguiente ciclo DESPUÉS de que el actual terminó.
    // En este punto getNextCycleIntervalMs() ya refleja el estado actualizado.
    scheduleNextCycle();
  }, intervalMs);
}

export function startScheduler(): void {
  stopped = false;

  logger.info(
    { baseInterval: `${env.ANALYSIS_INTERVAL_MINUTES}m`, activeInterval: '15m' },
    'Iniciando scheduler con intervalos dinámicos',
  );
  logger.info('Ejecutando primer ciclo inmediatamente...');

  // Ejecutar el primer ciclo inmediatamente, sin espera
  isRunning = true;
  runAnalysisCycle()
    .catch((err: unknown) => {
      logger.error(err, 'Error en primer ciclo');
    })
    .finally(() => {
      isRunning = false;
      // Tras el primer ciclo, arrancar el loop dinámico
      scheduleNextCycle();
    });
}

export function stopScheduler(): void {
  stopped = true;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  logger.info('Scheduler detenido');
}
