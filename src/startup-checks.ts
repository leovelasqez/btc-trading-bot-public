/**
 * Verificaciones de seguridad al arrancar el bot y durante cada ciclo.
 * Detecta posiciones sin SL y limit orders huérfanas.
 */
import { logger } from './config/logger.js';
import { fetchPositionData } from './exchange/position-data.js';
import type { PositionData } from './exchange/position-data.js';
import { getOpenOrders, getPendingLimitOrders, placeStopLoss, cancelAllOrders } from './exchange/orders.js';
import { sendMessage } from './notifications/telegram-bot.js';

/**
 * Red de seguridad para cada ciclo: si la posición ya obtenida no tiene SL
 * (ej: fill de limit order perdido por WebSocket) → coloca SL de emergencia al 3%.
 * Recibe positionData ya obtenido para no repetir la llamada a Binance.
 */
export async function ensurePositionHasSL(positionData: PositionData): Promise<void> {
  try {
    const openOrders = await getOpenOrders();
    const hasSL = openOrders.some((o) => o.type === 'STOP_MARKET' || o.type === 'STOP');

    if (!hasSL) {
      const slPct = 0.03;
      const emergencySL = positionData.side === 'LONG'
        ? Math.round(positionData.entryPrice * (1 - slPct) * 100) / 100
        : Math.round(positionData.entryPrice * (1 + slPct) * 100) / 100;
      const slSide = positionData.side === 'LONG' ? 'sell' : 'buy';

      logger.warn(
        { side: positionData.side, entry: positionData.entryPrice, emergencySL },
        'CICLO: Posición sin SL detectada — colocando SL de emergencia al 3%',
      );
      await placeStopLoss(slSide as 'buy' | 'sell', positionData.quantity, emergencySL);
      await sendMessage(
        `⚠️ CICLO: Posición ${positionData.side} sin SL detectada.\n` +
        `SL de emergencia colocado @ $${emergencySL} (3% desde entrada $${positionData.entryPrice})`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ error: msg }, 'Error verificando SL de posición en ciclo (ignorado)');
  }
}

/**
 * Si hay posición abierta sin SL → coloca SL de emergencia al 3%.
 * Si hay limit orders sin tracking en memoria → las cancela (sin SL/TP conocidos es peligroso).
 */
export async function checkStartupSafety(): Promise<void> {
  try {
    const positionData = await fetchPositionData();

    if (positionData) {
      const openOrders = await getOpenOrders();
      const hasSL = openOrders.some((o) => o.type === 'STOP_MARKET' || o.type === 'STOP');

      if (!hasSL) {
        const slPct = 0.03;
        const emergencySL = positionData.side === 'LONG'
          ? Math.round(positionData.entryPrice * (1 - slPct) * 100) / 100
          : Math.round(positionData.entryPrice * (1 + slPct) * 100) / 100;
        const slSide = positionData.side === 'LONG' ? 'sell' : 'buy';

        logger.warn(
          { side: positionData.side, entry: positionData.entryPrice, emergencySL },
          'ARRANQUE: Posición sin SL detectada — colocando SL de emergencia al 3%',
        );
        await placeStopLoss(slSide as 'buy' | 'sell', positionData.quantity, emergencySL);
        await sendMessage(
          `⚠️ ARRANQUE: Posición ${positionData.side} sin SL detectada.\n` +
          `SL de emergencia colocado @ $${emergencySL} (3% desde entrada $${positionData.entryPrice})`,
        );
      }
      // Si hay posición, no puede haber limit orders pendientes — no seguir chequeando
      return;
    }

    // Sin posición — verificar limit orders huérfanas (sin SL/TP en memoria tras reinicio)
    const pendingOrders = await getPendingLimitOrders();
    if (pendingOrders.length > 0) {
      logger.warn(
        { count: pendingOrders.length },
        'ARRANQUE: Limit order(s) sin tracking en memoria — cancelando (sin SL/TP registrados)',
      );
      await cancelAllOrders();
      await sendMessage(
        `⚠️ ARRANQUE: ${pendingOrders.length} limit order(s) encontradas sin tracking.\n` +
        `Canceladas automáticamente (SL/TP desconocidos tras reinicio).`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ error: msg }, 'Error en verificación de seguridad al arrancar (ignorado)');
  }
}
