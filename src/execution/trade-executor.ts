/**
 * Trade Executor — ejecuta trades completos (MARKET: entry + SL + TP, LIMIT: solo orden)
 */
import type { AiResponse } from '../ai/response-parser.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { setMarginMode, setLeverage, openMarketOrder, placeLimitOrder, placeStopLoss, placeTakeProfit, getBalance, cancelAllOrders, hasOpenPosition, closePosition } from '../exchange/orders.js';
import { calculatePositionSize } from '../risk/position-sizer.js';
import { checkCircuitBreaker } from '../risk/circuit-breaker.js';
import { logTradeOpen, updateBotState } from '../storage/trade-logger.js';
import { sendMessage } from '../notifications/telegram-bot.js';
import { formatTradeExecuted, formatLimitOrderPlaced } from '../notifications/alert-formatter.js';

interface MarketTradeSuccess {
  success: true;
  orderType: 'MARKET';
  tradeId: string;
  entryPrice: number;
  quantity: number;
  positionSize: number;
}

interface LimitOrderSuccess {
  success: true;
  orderType: 'LIMIT';
  orderId: string;
  limitPrice: number;
  quantity: number;
  positionSize: number;
  side: 'LONG' | 'SHORT';
  stopLoss: number;
  takeProfit: number | null;
}

interface TradeFailure {
  success: false;
  reason: string;
}

export type TradeResult = MarketTradeSuccess | LimitOrderSuccess | TradeFailure;

export async function executeTrade(
  aiResponse: AiResponse,
  aiDecisionId: string,
): Promise<TradeResult> {
  const { signal, entry_price, stop_loss, take_profit, order_type } = aiResponse;

  if (signal === 'WAIT' || entry_price === null || stop_loss === null) {
    return { success: false, reason: 'No hay señal tradeable' };
  }

  // Default to MARKET for backward compatibility
  const effectiveOrderType = order_type ?? 'MARKET';

  try {
    // 1. Verificar si ya hay posición abierta
    const position = await hasOpenPosition();
    if (position.open) {
      return { success: false, reason: `Ya hay posición ${position.side} abierta (${position.size} BTC)` };
    }

    // 2. Obtener balance
    const balance = await getBalance();
    if (balance <= 0) {
      return { success: false, reason: `Balance insuficiente: $${balance}` };
    }

    // 3. Circuit breaker check
    const cbCheck = await checkCircuitBreaker(balance);
    if (!cbCheck.canTrade) {
      logger.warn({ reason: cbCheck.reason }, 'Circuit breaker bloqueó el trade');
      return { success: false, reason: `Circuit breaker: ${cbCheck.reason}` };
    }

    // 4. Calcular tamaño de posición (dinámico según confidence)
    const posSize = calculatePositionSize(balance, entry_price, stop_loss, aiResponse.confidence);
    if (posSize.quantity <= 0) {
      return { success: false, reason: 'Cantidad calculada es 0' };
    }

    // 5. Configurar margin mode y leverage, luego cancelar órdenes previas
    //    Siempre CROSS (Multi-Assets mode no permite ISOLATED)
    //    setMarginMode/setLeverage se ejecutan ANTES de cancelar órdenes
    //    porque solo fallan si hay que CAMBIAR el modo (ya estamos en CROSS)
    try {
      await setMarginMode('cross');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      // -4046 = "No need to change margin type" → ya está en CROSS, OK
      if (!msg.includes('-4046')) {
        logger.warn({ error: msg }, 'Error configurando margin mode (ignorado, probablemente ya está en CROSS)');
      }
    }
    try {
      await setLeverage();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      logger.warn({ error: msg }, 'Error configurando leverage (ignorado, probablemente ya está configurado)');
    }
    await cancelAllOrders();

    if (effectiveOrderType === 'LIMIT') {
      return await executeLimitOrder(signal, entry_price, stop_loss, take_profit, posSize);
    }

    return await executeMarketOrder(signal, entry_price, stop_loss, take_profit, posSize, aiDecisionId, balance);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ error: message }, 'Error ejecutando trade');
    await sendMessage(`🚨 Error ejecutando trade: ${message}`);
    return { success: false, reason: message };
  }
}

/**
 * Ejecuta una orden MARKET con SL/TP inmediatos y registro en Supabase
 */
async function executeMarketOrder(
  signal: 'LONG' | 'SHORT',
  entryPrice: number,
  stopLoss: number,
  takeProfit: number | null,
  posSize: { quantity: number; positionSizeUsdt: number; marginUsdt: number },
  aiDecisionId: string,
  balance: number,
): Promise<MarketTradeSuccess | TradeFailure> {
  // 6. Abrir posición market
  const side = signal === 'LONG' ? 'buy' : 'sell';
  const entryOrder = await openMarketOrder(side as 'buy' | 'sell', posSize.quantity);

  // 7. Colocar Stop Loss — crítico: sin SL cerramos la posición de emergencia
  const slSide = signal === 'LONG' ? 'sell' : 'buy';
  let slOrder: Awaited<ReturnType<typeof placeStopLoss>>;
  try {
    slOrder = await placeStopLoss(slSide as 'buy' | 'sell', posSize.quantity, stopLoss);
  } catch (slErr: unknown) {
    const slMsg = slErr instanceof Error ? slErr.message : 'Unknown error';
    logger.error({ error: slMsg, stopLoss }, 'SL falló tras abrir posición — cerrando de emergencia');
    await sendMessage(`🚨 SL falló: ${slMsg}. Cerrando posición de emergencia.`);
    try {
      await closePosition(signal, posSize.quantity);
      logger.info('Posición cerrada de emergencia por fallo de SL');
    } catch (closeErr: unknown) {
      const closeMsg = closeErr instanceof Error ? closeErr.message : 'Unknown error';
      logger.error({ error: closeMsg }, 'Fallo al cerrar posición de emergencia — INTERVENCIÓN MANUAL');
      await sendMessage(`🚨 CRÍTICO: Posición ${signal} ABIERTA SIN SL y cierre automático falló. INTERVENCIÓN MANUAL REQUERIDA.`);
    }
    throw new Error(`SL no colocado: ${slMsg}`);
  }

  // 8. Colocar Take Profit (si existe)
  let tpOrderId: string | undefined;
  if (takeProfit !== null) {
    const tpOrder = await placeTakeProfit(slSide as 'buy' | 'sell', posSize.quantity, takeProfit);
    tpOrderId = tpOrder.orderId;
  }

  // 9. Registrar en Supabase
  const tradeId = await logTradeOpen({
    aiDecisionId,
    side: signal,
    leverage: env.LEVERAGE,
    entryPrice: entryOrder.price,
    quantity: entryOrder.quantity,
    positionSizeUsdt: posSize.positionSizeUsdt,
    stopLossPrice: stopLoss,
    takeProfitPrice: takeProfit,
    executionMode: 'full-auto',
    binanceOrderId: entryOrder.orderId,
    slOrderId: slOrder.orderId,
    tpOrderId,
  });

  // 10. Actualizar bot state
  await updateBotState({
    last_trade_at: new Date().toISOString(),
    current_balance: balance - posSize.marginUsdt,
  });

  // 11. Notificar por Telegram
  const tradeMsg = formatTradeExecuted(
    signal,
    entryOrder.price,
    entryOrder.quantity,
    posSize.positionSizeUsdt,
    stopLoss,
    takeProfit,
  );
  await sendMessage(tradeMsg);

  logger.info(
    {
      tradeId,
      signal,
      orderType: 'MARKET',
      entry: entryOrder.price,
      qty: entryOrder.quantity,
      sl: stopLoss,
      tp: takeProfit,
    },
    'Trade MARKET ejecutado exitosamente',
  );

  return {
    success: true,
    orderType: 'MARKET',
    tradeId,
    entryPrice: entryOrder.price,
    quantity: entryOrder.quantity,
    positionSize: posSize.positionSizeUsdt,
  };
}

/**
 * Coloca una orden LIMIT sin SL/TP (se colocan al detectar fill vía WebSocket)
 * No registra en Supabase — solo se logea cuando se llena.
 */
async function executeLimitOrder(
  signal: 'LONG' | 'SHORT',
  limitPrice: number,
  stopLoss: number,
  takeProfit: number | null,
  posSize: { quantity: number; positionSizeUsdt: number; marginUsdt: number },
): Promise<LimitOrderSuccess | TradeFailure> {
  // 6. Colocar orden limit al precio de entrada
  const side = signal === 'LONG' ? 'buy' : 'sell';
  const limitOrder = await placeLimitOrder(side as 'buy' | 'sell', posSize.quantity, limitPrice);

  // 7. Notificar por Telegram (sin logear en Supabase)
  const limitMsg = formatLimitOrderPlaced(
    signal,
    limitPrice,
    posSize.quantity,
    posSize.positionSizeUsdt,
    stopLoss,
    takeProfit,
  );
  await sendMessage(limitMsg);

  logger.info(
    {
      orderId: limitOrder.orderId,
      signal,
      orderType: 'LIMIT',
      limitPrice,
      qty: posSize.quantity,
      sl: stopLoss,
      tp: takeProfit,
    },
    'Orden LIMIT colocada exitosamente',
  );

  return {
    success: true,
    orderType: 'LIMIT',
    orderId: limitOrder.orderId,
    limitPrice,
    quantity: posSize.quantity,
    positionSize: posSize.positionSizeUsdt,
    side: signal,
    stopLoss,
    takeProfit,
  };
}
