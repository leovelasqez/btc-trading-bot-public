/**
 * Test: Ciclo completo SIN posición abierta
 * Ejecuta runAnalysisCycle() real: fetch datos → Gemini → ejecutar trade (si señal)
 * ⚠️ PUEDE ABRIR UNA POSICIÓN REAL si Gemini da señal con confidence >= 70%
 *
 * Uso: pm2 stop btc-bot && node dist/test-full-cycle.js
 */
import { getExchange } from './exchange/binance.js';
import { getBalance, hasOpenPosition, cancelAllOrders } from './exchange/orders.js';
import { startLiquidationCollector, stopLiquidationCollector } from './exchange/liquidation-ws.js';
import { startUserDataStream, stopUserDataStream } from './exchange/user-data-ws.js';
import { registerFillHandler } from './scheduler/analysis-cycle.js';
import { runAnalysisCycle } from './scheduler/analysis-cycle.js';
import { resetDailyStats } from './risk/circuit-breaker.js';
import { logger } from './config/logger.js';

async function test(): Promise<void> {
  try {
    // 0. Setup (mismo que index.ts)
    const exchange = getExchange();
    await exchange.loadMarkets();
    logger.info('Mercados cargados');

    const balance = await getBalance();
    logger.info({ balance }, 'Balance actual');

    // Verificar que NO hay posición abierta
    const pos = await hasOpenPosition();
    if (pos.open) {
      logger.error({ side: pos.side, size: pos.size }, '❌ Ya hay posición abierta — este test requiere sin posición');
      process.exit(1);
    }
    logger.info('✅ Sin posición abierta — OK para test');

    // Cancelar órdenes previas
    await cancelAllOrders();

    // Iniciar WebSockets (necesarios para el ciclo)
    startLiquidationCollector();
    startUserDataStream();
    registerFillHandler();

    // Esperar conexión de WebSockets
    await new Promise((resolve) => setTimeout(resolve, 5000));
    logger.info('✅ WebSockets conectados');

    // Reset daily stats
    await resetDailyStats(balance);

    // 1. Ejecutar ciclo completo
    logger.info('━━━ EJECUTANDO CICLO COMPLETO (sin posición) ━━━');
    await runAnalysisCycle();
    logger.info('━━━ CICLO COMPLETADO ━━━');

    // 2. Verificar estado después del ciclo
    const posAfter = await hasOpenPosition();
    const balanceAfter = await getBalance();
    const diff = balanceAfter - balance;

    logger.info({
      positionOpened: posAfter.open,
      side: posAfter.side ?? 'N/A',
      size: posAfter.size ?? 0,
      balanceBefore: balance,
      balanceAfter,
      diff: diff.toFixed(4),
    }, '=== RESULTADO DEL TEST ===');

    if (posAfter.open) {
      logger.info('⚠️ Se abrió posición real — cerrando para limpiar test');
      const { openMarketOrder } = await import('./exchange/orders.js');
      await cancelAllOrders();
      const closeSide = posAfter.side === 'LONG' ? 'sell' : 'buy';
      await openMarketOrder(closeSide as 'buy' | 'sell', posAfter.size!);
      logger.info('✅ Posición cerrada');
    }

    // Cleanup
    stopLiquidationCollector();
    stopUserDataStream();

  } catch (err) {
    logger.error({ err }, '❌ TEST FALLÓ');
    try {
      stopLiquidationCollector();
      stopUserDataStream();
    } catch { /* ignore */ }
  }

  // Esperar un poco para que los logs se escriban
  await new Promise((resolve) => setTimeout(resolve, 2000));
  process.exit(0);
}

test();
