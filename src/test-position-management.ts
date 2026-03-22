/**
 * Test: Ciclo completo CON posición abierta (gestión de posición)
 * 1. Abre posición LONG market (0.002 BTC) con SL/TP
 * 2. Ejecuta runAnalysisCycle() → debe entrar en gestión de posición
 * 3. Cierra posición y limpia
 *
 * Costo: ~$0.15 en comisiones
 * Uso: pm2 stop btc-bot && node dist/test-position-management.js
 */
import { getExchange } from './exchange/binance.js';
import {
  getBalance,
  hasOpenPosition,
  cancelAllOrders,
  setMarginMode,
  setLeverage,
  openMarketOrder,
  placeStopLoss,
  placeTakeProfit,
} from './exchange/orders.js';
import { startLiquidationCollector, stopLiquidationCollector } from './exchange/liquidation-ws.js';
import { startUserDataStream, stopUserDataStream } from './exchange/user-data-ws.js';
import { registerFillHandler } from './scheduler/analysis-cycle.js';
import { runAnalysisCycle } from './scheduler/analysis-cycle.js';
import { resetDailyStats } from './risk/circuit-breaker.js';
import { logTradeOpen } from './storage/trade-logger.js';
import { getSupabase } from './storage/supabase-client.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { SYMBOL } from './config/constants.js';

const QTY = 0.002;

async function test(): Promise<void> {
  try {
    // 0. Setup
    const exchange = getExchange();
    await exchange.loadMarkets();
    logger.info('Mercados cargados');

    const balance = await getBalance();
    logger.info({ balance }, 'Balance actual');

    // Verificar que NO hay posición abierta
    const pos = await hasOpenPosition();
    if (pos.open) {
      logger.error({ side: pos.side, size: pos.size }, '❌ Ya hay posición abierta — limpia antes de correr este test');
      process.exit(1);
    }

    // Cancelar órdenes previas
    await cancelAllOrders();

    // Iniciar WebSockets
    startLiquidationCollector();
    startUserDataStream();
    registerFillHandler();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    logger.info('✅ WebSockets conectados');

    await resetDailyStats(balance);

    // 1. Abrir posición LONG con SL/TP
    logger.info('━━━ ABRIENDO POSICIÓN DE PRUEBA ━━━');
    await setMarginMode('cross');
    await setLeverage();

    const ticker = await exchange.fetchTicker(SYMBOL);
    const price = ticker.last ?? 0;
    const sl = Math.round(price * 0.97 * 100) / 100; // SL 3% abajo
    const tp = Math.round(price * 1.03 * 100) / 100;  // TP 3% arriba

    const entry = await openMarketOrder('buy', QTY);
    logger.info({ orderId: entry.orderId, price: entry.price, qty: entry.quantity }, '✅ Posición LONG abierta');

    const slOrder = await placeStopLoss('sell', QTY, sl);
    logger.info({ orderId: slOrder.orderId, sl }, '✅ SL colocado');

    const tpOrder = await placeTakeProfit('sell', QTY, tp);
    logger.info({ orderId: tpOrder.orderId, tp }, '✅ TP colocado');

    // Registrar señal + decisión + trade en Supabase (respetando foreign keys)
    const supabase = getSupabase();

    const { data: signalData, error: signalErr } = await supabase
      .from('signals')
      .insert({
        btc_price: entry.price,
        funding_rate: 0,
        tf_15m_rsi: 50, tf_15m_ema_9: entry.price, tf_15m_ema_21: entry.price, tf_15m_volume: 0,
        tf_4h_rsi: 50, tf_4h_ema_9: entry.price, tf_4h_ema_21: entry.price, tf_4h_volume: 0,
      })
      .select('id')
      .single();
    if (signalErr) throw new Error(`Signal insert failed: ${signalErr.message}`);
    logger.info({ signalId: signalData.id }, '✅ Signal test registrada');

    const { data: decisionData, error: decisionErr } = await supabase
      .from('ai_decisions')
      .insert({
        signal_id: signalData.id,
        ai_signal: 'LONG',
        confidence: 80,
        reasoning: 'Test position management',
        suggested_entry: entry.price,
        suggested_stop_loss: sl,
        suggested_take_profit: tp,
        model_used: 'test',
        latency_ms: 0,
        raw_response: { test: true },
        accepted: true,
      })
      .select('id')
      .single();
    if (decisionErr) throw new Error(`Decision insert failed: ${decisionErr.message}`);
    logger.info({ decisionId: decisionData.id }, '✅ Decision test registrada');

    await logTradeOpen({
      aiDecisionId: decisionData.id as string,
      side: 'LONG',
      leverage: env.LEVERAGE,
      entryPrice: entry.price,
      quantity: entry.quantity,
      positionSizeUsdt: entry.price * entry.quantity,
      stopLossPrice: sl,
      takeProfitPrice: tp,
      executionMode: 'full-auto',
      binanceOrderId: entry.orderId,
      slOrderId: slOrder.orderId,
      tpOrderId: tpOrder.orderId,
    });
    logger.info('✅ Trade registrado en Supabase');

    // 2. Ejecutar ciclo — debe detectar posición y entrar en gestión
    logger.info('━━━ EJECUTANDO CICLO (con posición abierta) ━━━');
    await runAnalysisCycle();
    logger.info('━━━ CICLO DE GESTIÓN COMPLETADO ━━━');

    // 3. Verificar que la posición sigue abierta (Gemini no debería cerrar con 3% de rango)
    const posAfter = await hasOpenPosition();
    logger.info({
      positionStillOpen: posAfter.open,
      side: posAfter.side ?? 'N/A',
      size: posAfter.size ?? 0,
    }, 'Estado de posición después del ciclo de gestión');

    // 4. Limpiar: cancelar órdenes y cerrar posición
    logger.info('━━━ LIMPIEZA ━━━');
    await cancelAllOrders();
    if (posAfter.open) {
      await openMarketOrder('sell', posAfter.size!);
      logger.info('✅ Posición cerrada');
    }

    // Cleanup WebSockets
    stopLiquidationCollector();
    stopUserDataStream();

    const balanceAfter = await getBalance();
    const diff = balanceAfter - balance;
    logger.info({
      balanceBefore: balance,
      balanceAfter,
      diff: diff.toFixed(4),
    }, '=== TEST COMPLETADO ===');

  } catch (err) {
    logger.error({ err }, '❌ TEST FALLÓ');
    // Emergency cleanup
    try {
      await cancelAllOrders();
      const pos = await hasOpenPosition();
      if (pos.open) {
        await openMarketOrder('sell', pos.size!);
      }
      stopLiquidationCollector();
      stopUserDataStream();
    } catch { /* ignore */ }
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
  process.exit(0);
}

test();
