/**
 * Ciclo de análisis — lógica principal del bot
 * Soporta: señales MARKET y LIMIT, gestión de posición abierta,
 * gestión de limit orders pendientes, y fill detection via WebSocket.
 */
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getExchange } from '../exchange/binance.js';
import { fetchAllTimeframes } from '../exchange/candles.js';
import { fetchAllMarketData } from '../exchange/market-data.js';
import { buildAnalysisPackage } from '../analysis/context-builder.js';
import { analyzeWithGemini, analyzeLimitOrderWithGemini } from '../ai/gemini-client.js';
import { logSignal, logAiDecision, updateBotState, getOpenTrade, logTradeClose, logTradeOpen, getBotState, updateTradeSLTP } from '../storage/trade-logger.js';
import { executeTrade } from '../execution/trade-executor.js';
import { checkCircuitBreaker } from '../risk/circuit-breaker.js';
import { getBalance, getOpenOrders, getPendingLimitOrders, cancelAllOrders, placeStopLoss, placeTakeProfit, hasOpenPosition } from '../exchange/orders.js';
import { fetchPositionData, fetchTradeCosts } from '../exchange/position-data.js';
import { manageOpenPosition } from '../execution/position-manager.js';
import { sendMessage } from '../notifications/telegram-bot.js';
import { formatSignalAlert, formatError, formatWaitSignal, formatLimitOrderManagement, formatLimitOrderFilled, formatTradeClosed } from '../notifications/alert-formatter.js';
import { onOrderFill, onPositionClose, type OrderFillEvent, type PositionCloseEvent } from '../exchange/user-data-ws.js';
import type { PendingLimitOrder } from '../ai/limit-order-prompt.js';
import { SYMBOL, ACTIVE_POSITION_INTERVAL_MINUTES } from '../config/constants.js';
import { ensurePositionHasSL } from '../startup-checks.js';

let cycleCount = 0;
let earlyCycleTimer: ReturnType<typeof setTimeout> | null = null;
let lastCycleHadOpenPosition = false;

// ─── Pending limit order tracking (in-memory) ───

interface PendingOrderState {
  orderId: string;
  side: 'LONG' | 'SHORT';
  limitPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number | null;
  placedAt: string;
  aiDecisionId: string;
}

let pendingLimitOrder: PendingOrderState | null = null;

export function getPendingOrder(): PendingOrderState | null {
  return pendingLimitOrder;
}

export function clearPendingOrder(): void {
  pendingLimitOrder = null;
}

/** @internal — solo para tests */
export function _setPendingOrderForTest(order: PendingOrderState | null): void {
  pendingLimitOrder = order;
}

/** @internal — solo para tests */
export function _setLastCycleHadOpenPositionForTest(value: boolean): void {
  lastCycleHadOpenPosition = value;
}

// ─── Fill handler (called by WebSocket) ───

export function registerFillHandler(): void {
  onOrderFill(async (fill: OrderFillEvent) => {
    if (!pendingLimitOrder) {
      logger.warn({ orderId: fill.orderId }, 'Fill recibido pero no hay limit order pendiente en tracking');
      return;
    }

    // Verify this fill corresponds to our tracked order
    if (fill.orderId !== pendingLimitOrder.orderId) {
      logger.info(
        { fillOrderId: fill.orderId, trackedOrderId: pendingLimitOrder.orderId },
        'Fill de otra orden, ignorando',
      );
      return;
    }

    logger.info(
      {
        orderId: fill.orderId,
        side: fill.side,
        avgPrice: fill.avgPrice,
        filledQty: fill.filledQuantity,
        isFullyFilled: fill.isFullyFilled,
      },
      'Limit order ejecutada — colocando SL/TP',
    );

    const order = pendingLimitOrder;
    const isPartialFill = !fill.isFullyFilled;

    try {
      // 1. Cancel any remaining part of the limit order if partial fill
      if (isPartialFill) {
        try {
          await cancelAllOrders();
          logger.info('Órdenes restantes canceladas (fill parcial)');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          logger.warn({ error: msg }, 'Error cancelando órdenes restantes');
        }
      }

      // 2. Determine actual position size — use cumulative fill qty but verify with
      //    actual Binance position for partial fills (avoids race conditions)
      let actualQty = fill.filledQuantity; // o.z = cumulative filled qty
      if (isPartialFill) {
        const currentPos = await hasOpenPosition();
        if (currentPos.open && currentPos.size && currentPos.size > 0) {
          actualQty = currentPos.size;
          logger.info({ filledEvent: fill.filledQuantity, actual: actualQty }, 'Cantidad ajustada a posición real (fill parcial)');
        }
      }

      // 3. Place SL immediately
      const slSide = order.side === 'LONG' ? 'sell' : 'buy';
      const slOrder = await placeStopLoss(slSide as 'buy' | 'sell', actualQty, order.stopLoss);

      // 4. Place TP if defined
      let tpOrderId: string | undefined;
      if (order.takeProfit !== null) {
        const tpOrder = await placeTakeProfit(slSide as 'buy' | 'sell', actualQty, order.takeProfit);
        tpOrderId = tpOrder.orderId;
      }

      // 5. Log trade in Supabase (now that position is open)
      const tradeId = await logTradeOpen({
        aiDecisionId: order.aiDecisionId,
        side: order.side,
        leverage: env.LEVERAGE,
        entryPrice: fill.avgPrice,
        quantity: actualQty,
        positionSizeUsdt: fill.avgPrice * actualQty,
        stopLossPrice: order.stopLoss,
        takeProfitPrice: order.takeProfit,
        executionMode: 'full-auto',
        binanceOrderId: fill.orderId,
        slOrderId: slOrder.orderId,
        tpOrderId,
      });

      // 6. Update bot state
      const balance = await getBalance();
      await updateBotState({
        last_trade_at: new Date().toISOString(),
        current_balance: balance,
      });

      // 7. Notify via Telegram
      const fillMsg = formatLimitOrderFilled(
        order.side,
        fill.avgPrice,
        actualQty,
        order.stopLoss,
        order.takeProfit,
        isPartialFill,
      );
      await sendMessage(fillMsg);

      logger.info(
        { tradeId, side: order.side, avgPrice: fill.avgPrice, qty: actualQty },
        'Limit order fill procesado: SL/TP colocados, trade logueado',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error: msg }, 'Error procesando fill de limit order');
      await sendMessage(`🚨 Error procesando fill de limit order: ${msg}`);
    } finally {
      // Clear pending order regardless of success/failure
      pendingLimitOrder = null;
    }
  });
}

// ─── Position close handler (WebSocket — SL/TP immediate notification) ───

export function registerPositionCloseHandler(): void {
  onPositionClose(async (event: PositionCloseEvent) => {
    logger.info(
      { orderType: event.orderType, avgPrice: event.avgPrice, qty: event.quantity },
      'SL/TP ejecutado — procesando cierre inmediato',
    );

    const openTrade = await getOpenTrade();
    if (!openTrade) {
      logger.warn('Position close event recibido pero no hay trade abierto en Supabase — ignorando');
      return;
    }

    try {
      const exitReason: 'stop_loss' | 'take_profit' =
        event.orderType === 'STOP_MARKET' ? 'stop_loss' : 'take_profit';

      const exitPrice = Math.round(event.avgPrice * 100) / 100;
      const priceDiff = openTrade.side === 'LONG'
        ? exitPrice - openTrade.entry_price
        : openTrade.entry_price - exitPrice;
      const pnlUsdt = Math.round(priceDiff * openTrade.quantity * 100) / 100;
      const pnlPct = Math.round((priceDiff / openTrade.entry_price) * 10000) / 100;
      const feesUsdt = Math.round(event.commission * 100) / 100;

      await logTradeClose({
        tradeId: openTrade.id,
        exitPrice,
        exitReason,
        pnlUsdt,
        pnlPercentage: Math.round((priceDiff / openTrade.entry_price) * 1000000) / 10000,
        feesUsdt,
      });

      const state = await getBotState();
      if (state) {
        await updateBotState({
          daily_pnl: Math.round((((state.daily_pnl as number) ?? 0) + pnlUsdt) * 100) / 100,
          daily_trades: ((state.daily_trades as number) ?? 0) + 1,
          daily_wins: ((state.daily_wins as number) ?? 0) + (pnlUsdt > 0 ? 1 : 0),
          daily_losses: ((state.daily_losses as number) ?? 0) + (pnlUsdt < 0 ? 1 : 0),
        });
      }

      const msg = formatTradeClosed(
        exitReason,
        openTrade.side,
        openTrade.entry_price,
        exitPrice,
        openTrade.quantity,
        pnlUsdt,
        pnlPct,
        feesUsdt,
        openTrade.stop_loss_price > 0 ? openTrade.stop_loss_price : null,
        openTrade.take_profit_price,
        openTrade.created_at,
      );
      await sendMessage(msg);

      // Cancelar orden huérfana (ej: si SL ejecutó, el TP queda abierto)
      try {
        await cancelAllOrders();
      } catch (cancelErr: unknown) {
        const cancelMsg = cancelErr instanceof Error ? cancelErr.message : 'Unknown error';
        logger.warn({ error: cancelMsg }, 'Error cancelando órdenes huérfanas (no crítico)');
      }

      logger.info(
        { tradeId: openTrade.id.slice(0, 8), exitReason, pnlUsdt },
        'Trade cerrado registrado via WebSocket inmediatamente',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error: msg }, 'Error procesando cierre de posición via WebSocket');
      await sendMessage(`🚨 Error registrando cierre de posición: ${msg}`);
    }
  });
}

// ─── Sync closed trades ───

async function syncClosedTrades(): Promise<void> {
  const openTrade = await getOpenTrade();
  if (!openTrade) return;

  logger.info(
    { tradeId: openTrade.id.slice(0, 8), side: openTrade.side },
    'Trade open en Supabase sin posición en Binance — sincronizando cierre',
  );

  try {
    const exchange = getExchange();
    const tradeOpenTime = new Date(openTrade.created_at).getTime();
    const recentTrades = await exchange.fetchMyTrades(SYMBOL, tradeOpenTime, 20);

    const closeSide = openTrade.side === 'LONG' ? 'sell' : 'buy';
    const closingTrades = recentTrades.filter((t) => {
      if (t.side !== closeSide) return false;
      const tradeTime = new Date(t.datetime ?? 0).getTime();
      return tradeTime > tradeOpenTime;
    });

    if (closingTrades.length === 0) {
      logger.warn('No se encontraron trades de cierre en Binance');
      return;
    }

    let totalQty = 0;
    let totalCost = 0;
    let totalFees = 0;
    const matchingFills = [];

    for (const t of closingTrades.reverse()) {
      if (totalQty >= openTrade.quantity) break;
      totalQty += t.amount ?? 0;
      totalCost += t.cost ?? 0;
      totalFees += Number(t.fee?.cost ?? 0);
      matchingFills.push(t);
    }

    if (matchingFills.length === 0) return;

    const exitPrice = totalCost / totalQty;

    let exitReason: 'stop_loss' | 'take_profit' | 'manual' = 'manual';
    if (openTrade.stop_loss_price > 0) {
      const slDiff = Math.abs(exitPrice - openTrade.stop_loss_price) / openTrade.stop_loss_price;
      if (openTrade.side === 'LONG' && exitPrice <= openTrade.stop_loss_price * 1.005) {
        exitReason = 'stop_loss';
      } else if (openTrade.side === 'SHORT' && exitPrice >= openTrade.stop_loss_price * 0.995) {
        exitReason = 'stop_loss';
      } else if (slDiff < 0.01) {
        exitReason = 'stop_loss';
      }
    }
    if (openTrade.take_profit_price && exitReason !== 'stop_loss') {
      const tpDiff = Math.abs(exitPrice - openTrade.take_profit_price) / openTrade.take_profit_price;
      if (openTrade.side === 'LONG' && exitPrice >= openTrade.take_profit_price * 0.995) {
        exitReason = 'take_profit';
      } else if (openTrade.side === 'SHORT' && exitPrice <= openTrade.take_profit_price * 1.005) {
        exitReason = 'take_profit';
      } else if (tpDiff < 0.01) {
        exitReason = 'take_profit';
      }
    }

    const priceDiff = openTrade.side === 'LONG'
      ? exitPrice - openTrade.entry_price
      : openTrade.entry_price - exitPrice;
    const pnlUsdt = priceDiff * openTrade.quantity;
    const pnlPct = (priceDiff / openTrade.entry_price) * 100;

    await logTradeClose({
      tradeId: openTrade.id,
      exitPrice: Math.round(exitPrice * 100) / 100,
      exitReason,
      pnlUsdt: Math.round(pnlUsdt * 100) / 100,
      pnlPercentage: Math.round(pnlPct * 10000) / 10000,
      feesUsdt: Math.round(totalFees * 100) / 100,
    });

    const state = await getBotState();
    if (state) {
      const dailyPnl = ((state.daily_pnl as number) ?? 0) + pnlUsdt;
      const dailyTrades = ((state.daily_trades as number) ?? 0) + 1;
      const dailyWins = ((state.daily_wins as number) ?? 0) + (pnlUsdt > 0 ? 1 : 0);
      const dailyLosses = ((state.daily_losses as number) ?? 0) + (pnlUsdt < 0 ? 1 : 0);
      await updateBotState({
        daily_pnl: Math.round(dailyPnl * 100) / 100,
        daily_trades: dailyTrades,
        daily_wins: dailyWins,
        daily_losses: dailyLosses,
      });
    }

    const pnlEmoji = pnlUsdt >= 0 ? '🟢' : '🔴';
    const reasonLabel = exitReason === 'stop_loss' ? '🛑 Stop Loss' : exitReason === 'take_profit' ? '🎯 Take Profit' : '📋 Manual';
    await sendMessage(
      `${reasonLabel} ejecutado por Binance\n\n` +
      `${openTrade.side} cerrado @ $${Math.round(exitPrice * 100) / 100}\n` +
      `${pnlEmoji} PnL: $${Math.round(pnlUsdt * 100) / 100} (${pnlPct >= 0 ? '+' : ''}${Math.round(pnlPct * 100) / 100}%)\n` +
      `Comisiones: $${Math.round(totalFees * 100) / 100}`,
    );

    // Cancelar órdenes huérfanas (ej: si SL ejecutó, el TP queda abierto)
    try {
      await cancelAllOrders();
      logger.info('Órdenes huérfanas canceladas tras cierre de posición');
    } catch (cancelErr: unknown) {
      const cancelMsg = cancelErr instanceof Error ? cancelErr.message : 'Unknown error';
      logger.warn({ error: cancelMsg }, 'Error cancelando órdenes huérfanas (no crítico)');
    }

    logger.info(
      {
        tradeId: openTrade.id.slice(0, 8),
        exitPrice: Math.round(exitPrice * 100) / 100,
        exitReason,
        pnlUsdt: Math.round(pnlUsdt * 100) / 100,
      },
      'Trade sincronizado como cerrado',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ error: msg }, 'Error sincronizando trade cerrado');
  }
}

// ─── Early cycle retry ───

function scheduleEarlyCycle(): void {
  if (earlyCycleTimer) return;

  const delayMs = 15 * 60 * 1000;
  logger.info('Agendando ciclo temprano en 15 minutos por fallo de Gemini');

  earlyCycleTimer = setTimeout(() => {
    earlyCycleTimer = null;
    logger.info('━━━ Ejecutando ciclo temprano (retry por fallo de Gemini) ━━━');
    runAnalysisCycle().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error: msg }, 'Error en ciclo temprano');
    });
  }, delayMs);
}

// ─── Manage pending limit order ───

async function managePendingLimitOrder(
  pkg: { context: ReturnType<typeof buildAnalysisPackage>['context'] },
  balance: number,
): Promise<void> {
  if (!pendingLimitOrder) return;

  // Verify the limit order still exists in Binance
  const binancePending = await getPendingLimitOrders();
  const stillExists = binancePending.some((o) => o.orderId === pendingLimitOrder!.orderId);

  if (!stillExists) {
    // Order was filled or cancelled externally
    logger.info({ orderId: pendingLimitOrder.orderId }, 'Limit order ya no existe en Binance — limpiando tracking');
    pendingLimitOrder = null;
    return;
  }

  // Ask Gemini what to do
  const pending: PendingLimitOrder = {
    side: pendingLimitOrder.side,
    limitPrice: pendingLimitOrder.limitPrice,
    quantity: pendingLimitOrder.quantity,
    stopLoss: pendingLimitOrder.stopLoss,
    takeProfit: pendingLimitOrder.takeProfit,
    placedAt: pendingLimitOrder.placedAt,
    orderId: pendingLimitOrder.orderId,
  };

  const aiResult = await analyzeLimitOrderWithGemini(pkg.context, pending);

  if (!aiResult.success) {
    logger.error({ error: aiResult.error }, 'Gemini falló en gestión de limit order');
    await sendMessage(`🚨 Error Gemini (limit order): ${aiResult.error}`);
    scheduleEarlyCycle();
    return;
  }

  const { data } = aiResult;
  logger.info(
    { action: data.action, confidence: data.confidence },
    'Gemini decidió sobre limit order pendiente',
  );

  // Notify via Telegram
  const mgmtMsg = formatLimitOrderManagement(
    data.action,
    pendingLimitOrder.side,
    pendingLimitOrder.limitPrice,
    pkg.context.currentPrice,
    data.reasoning,
    data.confidence,
    data.new_order_type,
    data.new_entry_price,
  );
  await sendMessage(mgmtMsg);

  switch (data.action) {
    case 'KEEP':
      logger.info('Limit order mantenida');
      break;

    case 'CANCEL':
      await cancelAllOrders();
      pendingLimitOrder = null;
      logger.info('Limit order cancelada por Gemini');
      break;

    case 'REPLACE': {
      // Cancel current order
      await cancelAllOrders();
      pendingLimitOrder = null;

      // Build a synthetic AI response to execute the replacement
      if (data.new_order_type && data.new_entry_price && data.new_stop_loss) {
        const syntheticResponse = {
          signal: pending.side as 'LONG' | 'SHORT',
          confidence: data.confidence,
          reasoning: data.reasoning,
          order_type: data.new_order_type as 'MARKET' | 'LIMIT',
          entry_price: data.new_entry_price,
          stop_loss: data.new_stop_loss,
          take_profit: data.new_take_profit,
          risk_reward_ratio: data.new_risk_reward_ratio,
          key_levels: { support: [], resistance: [] },
          warnings: data.warnings,
        };

        // Log the replacement decision
        const signalId = await logSignal({ context: pkg.context });
        const decisionId = await logAiDecision({
          signalId,
          aiResponse: syntheticResponse,
          accepted: true,
          latencyMs: aiResult.latencyMs,
          rawResponse: aiResult.rawText,
          modelUsed: aiResult.modelUsed,
        });

        const tradeResult = await executeTrade(syntheticResponse, decisionId);
        if (tradeResult.success && tradeResult.orderType === 'LIMIT') {
          pendingLimitOrder = {
            orderId: tradeResult.orderId,
            side: tradeResult.side,
            limitPrice: tradeResult.limitPrice,
            quantity: tradeResult.quantity,
            stopLoss: tradeResult.stopLoss,
            takeProfit: tradeResult.takeProfit,
            placedAt: new Date().toISOString(),
            aiDecisionId: decisionId,
          };
        }

        if (!tradeResult.success) {
          logger.warn({ reason: tradeResult.reason }, 'Replacement trade no ejecutado');
          await sendMessage(`⚠️ Reemplazo no ejecutado: ${tradeResult.reason}`);
        }
      }
      break;
    }
  }

  await updateBotState({
    last_analysis_at: new Date().toISOString(),
    current_balance: balance,
  });
}

// ─── Main cycle ───

export async function runAnalysisCycle(): Promise<void> {
  cycleCount++;
  const cycleStart = Date.now();
  logger.info({ cycle: cycleCount }, '━━━ Iniciando ciclo de análisis ━━━');

  try {
    // Pre-check: circuit breaker
    const balance = await getBalance();
    const cbCheck = await checkCircuitBreaker(balance);
    if (!cbCheck.canTrade) {
      logger.warn({ reason: cbCheck.reason }, 'Circuit breaker activo — saltando ciclo');
      await sendMessage(`⏸️ Ciclo #${cycleCount} saltado: ${cbCheck.reason}`);
      return;
    }

    // 1. Precio actual
    const exchange = getExchange();
    const ticker = await exchange.fetchTicker(SYMBOL);
    const currentPrice = ticker.last ?? 0;
    logger.info({ price: currentPrice }, `Precio ${SYMBOL}`);

    // 2. Verificar si hay posición abierta
    const positionData = await fetchPositionData();

    // 2.5a Red de seguridad: posición sin SL (ej: fill perdido por WebSocket) → SL emergencia
    if (positionData) {
      await ensurePositionHasSL(positionData);
    }

    // 2.5b Sincronizar: si no hay posición en Binance pero sí en Supabase → SL/TP ejecutado
    if (!positionData) {
      await syncClosedTrades();
    }

    // 3. Fetch velas (4 timeframes) + market data en paralelo
    const [candles, marketData] = await Promise.all([
      fetchAllTimeframes(),
      fetchAllMarketData(),
    ]);

    const fundingRate = marketData.markPremium.lastFundingRate;

    // 4. Indicadores (4 timeframes) + market data
    const pkg = buildAnalysisPackage({
      candles_15m: candles.tf_15m,
      candles_1h: candles.tf_1h,
      candles_4h: candles.tf_4h,
      candles_1d: candles.tf_1d,
      currentPrice,
      fundingRate,
      balance,
      marketData,
    });

    // 5. Si hay posición abierta → gestionar posición (no buscar nueva señal)
    if (positionData) {
      logger.info(
        { side: positionData.side, entry: positionData.entryPrice, pnl: positionData.unrealizedPnl },
        'Posición abierta detectada — ejecutando gestión de posición',
      );

      const costs = await fetchTradeCosts(positionData);
      const result = await manageOpenPosition(positionData, costs, pkg.context);

      logger.info(
        { action: result.action, executed: result.executed },
        'Gestión de posición completada',
      );

      if (result.action === 'ERROR') {
        scheduleEarlyCycle();
      }

      await updateBotState({
        last_analysis_at: new Date().toISOString(),
        current_balance: balance,
      });

      lastCycleHadOpenPosition = true;
      const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
      logger.info({ cycle: cycleCount, elapsed: `${elapsed}s` }, 'Ciclo completado (gestión de posición)');
      return;
    }

    lastCycleHadOpenPosition = false;

    // 5.5 Si hay limit order pendiente → gestionar con Gemini
    if (pendingLimitOrder) {
      logger.info(
        { orderId: pendingLimitOrder.orderId, side: pendingLimitOrder.side, limitPrice: pendingLimitOrder.limitPrice },
        'Limit order pendiente detectada — ejecutando gestión',
      );

      await managePendingLimitOrder(pkg, balance);

      const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
      logger.info({ cycle: cycleCount, elapsed: `${elapsed}s` }, 'Ciclo completado (gestión de limit order)');
      return;
    }

    // 6. Gemini AI — buscar nueva señal (data-only, sin imágenes)
    const aiResult = await analyzeWithGemini(pkg.context);

    // Log signal
    const signalId = await logSignal({ context: pkg.context });

    if (!aiResult.success) {
      logger.error({ error: aiResult.error }, 'Gemini falló (ambos modelos)');
      await logAiDecision({
        signalId,
        aiResponse: {
          signal: 'WAIT', confidence: 0,
          reasoning: `Gemini error: ${aiResult.error}`,
          order_type: null,
          entry_price: null, stop_loss: null, take_profit: null,
          risk_reward_ratio: null,
          key_levels: { support: [], resistance: [] },
          warnings: [],
        },
        accepted: false,
        rejectionReason: 'api_failure',
        latencyMs: aiResult.latencyMs,
        rawResponse: JSON.stringify({ error: aiResult.error }),
        modelUsed: aiResult.modelUsed,
      });
      await sendMessage(formatError(aiResult.error));
      scheduleEarlyCycle();
      return;
    }

    const { data } = aiResult;
    logger.info({ signal: data.signal, confidence: data.confidence, orderType: data.order_type, model: aiResult.modelUsed }, 'Gemini respondió');

    // 7. Evaluar threshold
    let accepted = false;
    let rejectionReason: string | undefined;

    if (data.signal === 'WAIT') {
      rejectionReason = 'wait_signal';
    } else if (data.confidence < env.CONFIDENCE_THRESHOLD) {
      rejectionReason = 'low_confidence';
    } else {
      accepted = true;
    }

    const decisionId = await logAiDecision({
      signalId,
      aiResponse: data,
      accepted,
      rejectionReason,
      latencyMs: aiResult.latencyMs,
      rawResponse: aiResult.rawText,
      modelUsed: aiResult.modelUsed,
    });

    // 8. Notify via Telegram (always — same full format for all signals)
    const alertMsg = formatSignalAlert(data, pkg.context, decisionId, aiResult.modelUsed);
    await sendMessage(alertMsg);

    // 9. Execute trade (full-auto)
    if (accepted && data.signal !== 'WAIT') {
      // Cancelar órdenes pendientes en Binance antes de ejecutar (SL/TP huérfanos, limits viejas)
      const existingOrders = await getOpenOrders();
      if (existingOrders.length > 0) {
        logger.info(
          { count: existingOrders.length, types: existingOrders.map((o) => o.type) },
          'Cancelando órdenes existentes antes de ejecutar nuevo trade',
        );
        await cancelAllOrders();
      }

      logger.info({ orderType: data.order_type }, 'Ejecutando trade (full-auto)');
      const tradeResult = await executeTrade(data, decisionId);

      if (tradeResult.success) {
        if (tradeResult.orderType === 'LIMIT') {
          // Track the pending limit order
          pendingLimitOrder = {
            orderId: tradeResult.orderId,
            side: tradeResult.side,
            limitPrice: tradeResult.limitPrice,
            quantity: tradeResult.quantity,
            stopLoss: tradeResult.stopLoss,
            takeProfit: tradeResult.takeProfit,
            placedAt: new Date().toISOString(),
            aiDecisionId: decisionId,
          };
          logger.info({ orderId: tradeResult.orderId }, 'Limit order tracked para fill detection');
        } else {
          logger.info({ tradeId: tradeResult.tradeId }, 'Trade MARKET ejecutado');
        }
      } else {
        logger.warn({ reason: tradeResult.reason }, 'Trade no ejecutado');
        await sendMessage(`⚠️ Trade no ejecutado: ${tradeResult.reason}`);
      }
    }

    // 10. Actualizar estado del bot
    await updateBotState({
      last_analysis_at: new Date().toISOString(),
      current_balance: balance,
    });

    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    logger.info({ cycle: cycleCount, elapsed: `${elapsed}s` }, 'Ciclo completado');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ error: message, cycle: cycleCount }, 'Error en ciclo de análisis');
    await updateBotState({
      last_error: message,
      last_error_at: new Date().toISOString(),
    });
    try {
      await sendMessage(formatError(`Ciclo #${cycleCount}: ${message}`));
    } catch { /* ignore telegram error */ }
  }
}

/**
 * Devuelve el intervalo de espera hasta el próximo ciclo en milisegundos,
 * basándose en el estado actual del bot al terminar el último ciclo.
 *
 * - Con posición abierta o limit order pendiente: ACTIVE_POSITION_INTERVAL_MINUTES (15 min)
 * - Sin estado activo: ANALYSIS_INTERVAL_MINUTES (configurable por env, default 30 min)
 */
export function getNextCycleIntervalMs(): number {
  const hasActiveState = pendingLimitOrder !== null || lastCycleHadOpenPosition;
  if (hasActiveState) {
    return ACTIVE_POSITION_INTERVAL_MINUTES * 60 * 1000;
  }
  return env.ANALYSIS_INTERVAL_MINUTES * 60 * 1000;
}
