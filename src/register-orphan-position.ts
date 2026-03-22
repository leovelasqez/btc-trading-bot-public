/**
 * Script temporal: Registra una posición huérfana de Binance en Supabase
 * para que el bot pueda gestionarla con AI.
 *
 * Uso: node dist/register-orphan-position.js
 */
import { getExchange } from './exchange/binance.js';
import { hasOpenPosition, getOpenOrders, placeStopLoss } from './exchange/orders.js';
import { fetchPositionData } from './exchange/position-data.js';
import { logTradeOpen } from './storage/trade-logger.js';
import { getSupabase } from './storage/supabase-client.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function register(): Promise<void> {
  try {
    // 1. Cargar mercados
    const exchange = getExchange();
    await exchange.loadMarkets();

    // 2. Verificar posición abierta
    const pos = await hasOpenPosition();
    if (!pos.open) {
      logger.info('No hay posición abierta en Binance — nada que registrar');
      process.exit(0);
    }

    // 3. Obtener datos completos de posición
    const posData = await fetchPositionData();
    if (!posData) {
      logger.error('No se pudieron obtener datos de la posición');
      process.exit(1);
    }

    logger.info({
      side: posData.side,
      entry: posData.entryPrice,
      qty: posData.quantity,
      leverage: posData.leverage,
      pnl: posData.unrealizedPnl,
    }, 'Posición detectada');

    // 4. Obtener órdenes SL/TP
    const orders = await getOpenOrders();
    const slOrder = orders.find(o => o.type === 'STOP_MARKET' || o.type === 'STOP');
    const tpOrder = orders.find(o => o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT');

    let slPrice = slOrder?.stopPrice ?? 0;
    const tpPrice = tpOrder?.stopPrice ?? null;

    logger.info({
      sl: slPrice,
      tp: tpPrice,
      slOrderId: slOrder?.orderId ?? 'N/A',
      tpOrderId: tpOrder?.orderId ?? 'N/A',
    }, 'Órdenes SL/TP detectadas');

    // Si no hay SL, colocar uno al 3% del entry price
    let slOrderId = slOrder?.orderId;
    if (slPrice === 0) {
      logger.warn('No hay SL configurado — colocando SL al 3%');
      const autoSL = posData.side === 'LONG'
        ? Math.round(posData.entryPrice * 0.97 * 100) / 100
        : Math.round(posData.entryPrice * 1.03 * 100) / 100;
      const slSide = posData.side === 'LONG' ? 'sell' : 'buy';
      const newSlOrder = await placeStopLoss(slSide as 'buy' | 'sell', posData.quantity, autoSL);
      slPrice = autoSL;
      slOrderId = newSlOrder.orderId;
      logger.info({ sl: autoSL, orderId: newSlOrder.orderId }, '✅ SL colocado automáticamente');
    }

    // 5. Crear registros en Supabase (signal → decision → trade)
    const supabase = getSupabase();

    // 5a. Signal placeholder
    const { data: signalData, error: signalErr } = await supabase
      .from('signals')
      .insert({
        btc_price: posData.entryPrice,
        funding_rate: 0,
        tf_15m_rsi: 50, tf_15m_ema_9: posData.entryPrice, tf_15m_ema_21: posData.entryPrice, tf_15m_volume: 0,
        tf_4h_rsi: 50, tf_4h_ema_9: posData.entryPrice, tf_4h_ema_21: posData.entryPrice, tf_4h_volume: 0,
      })
      .select('id')
      .single();

    if (signalErr) throw new Error(`Signal insert failed: ${signalErr.message}`);
    logger.info({ signalId: signalData.id }, 'Signal placeholder creada');

    // 5b. AI Decision placeholder
    const { data: decisionData, error: decisionErr } = await supabase
      .from('ai_decisions')
      .insert({
        signal_id: signalData.id,
        ai_signal: posData.side,
        confidence: 70,
        reasoning: 'Posición registrada manualmente (huérfana de Binance)',
        suggested_entry: posData.entryPrice,
        suggested_stop_loss: slPrice,
        suggested_take_profit: tpPrice,
        model_used: 'manual-registration',
        latency_ms: 0,
        raw_response: { manual: true, reason: 'orphan position registration' },
        accepted: true,
      })
      .select('id')
      .single();

    if (decisionErr) throw new Error(`Decision insert failed: ${decisionErr.message}`);
    logger.info({ decisionId: decisionData.id }, 'Decision placeholder creada');

    // 5c. Trade
    const positionSizeUsdt = posData.entryPrice * posData.quantity;
    const tradeId = await logTradeOpen({
      aiDecisionId: decisionData.id as string,
      side: posData.side,
      leverage: posData.leverage,
      entryPrice: posData.entryPrice,
      quantity: posData.quantity,
      positionSizeUsdt,
      stopLossPrice: slPrice,
      takeProfitPrice: tpPrice,
      executionMode: 'full-auto',
      slOrderId,
      tpOrderId: tpOrder?.orderId,
    });

    logger.info({
      tradeId,
      side: posData.side,
      entry: posData.entryPrice,
      qty: posData.quantity,
      sl: slPrice,
      tp: tpPrice,
    }, '✅ Posición registrada en Supabase exitosamente');

  } catch (err) {
    logger.error({ err }, '❌ Error registrando posición');
  }

  process.exit(0);
}

register();
