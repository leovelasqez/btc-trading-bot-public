/**
 * Position Manager — gestiona posiciones abiertas
 * Analiza con Gemini si ajustar SL/TP o cerrar, valida reglas y ejecuta
 */
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import type { PositionData, TradeCosts } from '../exchange/position-data.js';
import type { MarketContext } from '../ai/prompt-template.js';
import type { PositionManagementResponse } from '../ai/position-response-parser.js';
import { analyzePositionWithGemini } from '../ai/gemini-client.js';
import {
  getOpenOrders,
  placeStopLoss,
  placeTakeProfit,
  closePosition,
  cancelAllOrders,
} from '../exchange/orders.js';
import {
  logPositionAdjustment,
  logTradeClose,
  getOpenTrade,
  updateTradeSLTP,
  updateBotState,
  getBotState,
} from '../storage/trade-logger.js';
import { sendMessage } from '../notifications/telegram-bot.js';
import { formatPositionManagement } from '../notifications/alert-formatter.js';

export interface PositionManagementResult {
  action: string;
  executed: boolean;
  reason?: string;
}

export async function manageOpenPosition(
  position: PositionData,
  costs: TradeCosts,
  context: MarketContext,
): Promise<PositionManagementResult> {
  const currentPrice = context.currentPrice;
  const atr15m = context.indicators.tf_15m.atr;

  // 1. Obtener trade de Supabase para linkear
  const openTrade = await getOpenTrade();
  if (!openTrade) {
    logger.warn('Posición abierta en Binance pero no se encontró trade en Supabase');
    return { action: 'HOLD', executed: false, reason: 'Trade no encontrado en Supabase' };
  }

  // 2. Obtener órdenes abiertas para SL/TP actuales
  const openOrders = await getOpenOrders();
  const slOrder = openOrders.find(
    (o) => o.type === 'STOP_MARKET' || o.type === 'STOP',
  );
  const tpOrder = openOrders.find(
    (o) => o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT',
  );

  const currentSL = slOrder?.stopPrice ?? openTrade.stop_loss_price;
  const currentTP = tpOrder?.stopPrice ?? openTrade.take_profit_price;

  logger.info(
    { currentSL, currentTP, side: position.side, price: currentPrice },
    'Estado actual de SL/TP',
  );

  // 3. Llamar a Gemini
  const aiResult = await analyzePositionWithGemini(
    context,
    position,
    costs,
    currentSL,
    currentTP,
  );

  if (!aiResult.success) {
    logger.error({ error: aiResult.error }, 'Gemini falló en gestión de posición');
    await sendMessage(`🚨 Error Gemini (posición): ${aiResult.error}`);
    return { action: 'ERROR', executed: false, reason: aiResult.error };
  }

  const { data } = aiResult;
  logger.info(
    { action: data.action, confidence: data.confidence },
    'Gemini decidió sobre posición',
  );

  // 4. Verificar umbral de confidence para gestión de posición
  // Umbral más bajo que para entradas nuevas: gestionar una posición abierta
  // requiere menos certeza que abrir una nueva. CLOSE nunca se bloquea.
  const POSITION_MGMT_CONFIDENCE = 55;
  if (data.action !== 'HOLD' && data.action !== 'CLOSE' && data.confidence < POSITION_MGMT_CONFIDENCE) {
    const reason = `Confidence ${data.confidence}% < umbral ${POSITION_MGMT_CONFIDENCE}% — HOLD forzado`;
    logger.info({ confidence: data.confidence, threshold: env.CONFIDENCE_THRESHOLD, suggestedAction: data.action }, reason);
    await logPositionAdjustment({
      tradeId: openTrade.id,
      adjustmentType: 'hold',
      previousSL: currentSL,
      previousTP: currentTP,
      newSL: null,
      newTP: null,
      aiConfidence: data.confidence,
      aiReasoning: data.reasoning,
      aiRawResponse: aiResult.rawText,
      btcPrice: currentPrice,
      unrealizedPnl: position.unrealizedPnl,
      fundingFeesAccumulated: costs.accumulatedFunding,
      netBreakeven: costs.netBreakeven,
      executed: false,
      executionError: reason,
      modelUsed: aiResult.modelUsed,
    });
    await sendMessage(`⚠️ Gestión posición: Gemini sugirió ${data.action} con confidence ${data.confidence}% (mínimo ${POSITION_MGMT_CONFIDENCE}%) — HOLD forzado`);
    return { action: 'HOLD', executed: false, reason };
  }

  // 5. Ejecutar según acción
  let executed = false;
  let executionError: string | undefined;
  let finalNewSL: number | null = null;
  let finalNewTP: number | null = null;

  try {
    switch (data.action) {
      case 'HOLD':
        executed = true;
        break;

      case 'ADJUST_SL':
        finalNewSL = validateAndGetSL(data, position, costs, currentPrice, currentSL, atr15m);
        if (finalNewSL !== null) {
          // Cancelar TODAS las órdenes y re-colocar ambas (evita Binance -4130)
          await cancelAllOrders();
          const slSideA = position.side === 'LONG' ? 'sell' : 'buy';
          await placeStopLoss(slSideA as 'buy' | 'sell', position.quantity, finalNewSL);
          if (currentTP !== null && currentTP > 0) {
            await placeTakeProfit(slSideA as 'buy' | 'sell', position.quantity, currentTP);
          }
          await updateTradeSLTP(openTrade.id, { stopLossPrice: finalNewSL });
          executed = true;
        } else {
          executionError = 'SL sugerido no cumple reglas de validación';
        }
        break;

      case 'ADJUST_TP':
        finalNewTP = data.new_take_profit;
        if (finalNewTP !== null) {
          // Validate TP is on the correct side of current price
          const isLongTP = position.side === 'LONG';
          const tpValid = isLongTP ? finalNewTP > currentPrice : finalNewTP < currentPrice;
          if (!tpValid) {
            logger.warn(
              { suggestedTP: finalNewTP, currentPrice, side: position.side },
              'TP rechazado: en el lado equivocado del precio actual',
            );
            executionError = 'TP inválido: debe estar por encima del precio actual (LONG) o por debajo (SHORT)';
            finalNewTP = null;
            break;
          }
          // Cancelar TODAS las órdenes y re-colocar ambas (evita Binance -4130)
          await cancelAllOrders();
          const tpSideA = position.side === 'LONG' ? 'sell' : 'buy';
          await placeStopLoss(tpSideA as 'buy' | 'sell', position.quantity, currentSL);
          await placeTakeProfit(tpSideA as 'buy' | 'sell', position.quantity, finalNewTP);
          await updateTradeSLTP(openTrade.id, { takeProfitPrice: finalNewTP });
          executed = true;
        }
        break;

      case 'ADJUST_BOTH':
        finalNewSL = validateAndGetSL(data, position, costs, currentPrice, currentSL, atr15m);
        finalNewTP = data.new_take_profit;

        if (finalNewSL !== null || finalNewTP !== null) {
          // Cancelar TODAS las órdenes y re-colocar ambas (evita Binance -4130)
          await cancelAllOrders();
          const bothSide = position.side === 'LONG' ? 'sell' : 'buy';
          const slPrice = finalNewSL ?? currentSL;
          const tpPrice = finalNewTP ?? currentTP;
          await placeStopLoss(bothSide as 'buy' | 'sell', position.quantity, slPrice);
          if (tpPrice !== null && tpPrice > 0) {
            await placeTakeProfit(bothSide as 'buy' | 'sell', position.quantity, tpPrice);
          }
          if (finalNewSL !== null) await updateTradeSLTP(openTrade.id, { stopLossPrice: finalNewSL });
          if (finalNewTP !== null) await updateTradeSLTP(openTrade.id, { takeProfitPrice: finalNewTP });
          executed = true;
        } else {
          executionError = 'Ningún ajuste pasó validación';
        }
        break;

      case 'CLOSE':
        await cancelAllOrders();
        const closeResult = await closePosition(position.side, position.quantity);
        // Calcular PnL
        const exitPrice = closeResult.price;
        const priceDiff = position.side === 'LONG'
          ? exitPrice - position.entryPrice
          : position.entryPrice - exitPrice;
        const pnlUsdt = priceDiff * position.quantity;
        const pnlPct = (priceDiff / position.entryPrice) * 100;

        await logTradeClose({
          tradeId: openTrade.id,
          exitPrice,
          exitReason: 'manual',
          pnlUsdt: Math.round(pnlUsdt * 100) / 100,
          pnlPercentage: Math.round(pnlPct * 10000) / 10000,
          feesUsdt: costs.totalCosts,
        });

        // Actualizar stats diarios
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

        executed = true;
        break;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ error: msg, action: data.action }, 'Error ejecutando gestión de posición');
    executionError = msg;
  }

  // 5. Determinar tipo de ajuste para logging
  const adjustmentType = getAdjustmentType(data.action, finalNewSL, finalNewTP);

  // 6. Log en Supabase
  await logPositionAdjustment({
    tradeId: openTrade.id,
    adjustmentType,
    previousSL: currentSL,
    previousTP: currentTP,
    newSL: finalNewSL,
    newTP: finalNewTP,
    aiConfidence: data.confidence,
    aiReasoning: data.reasoning,
    aiRawResponse: aiResult.rawText,
    btcPrice: currentPrice,
    unrealizedPnl: position.unrealizedPnl,
    fundingFeesAccumulated: costs.accumulatedFunding,
    netBreakeven: costs.netBreakeven,
    executed,
    executionError,
    modelUsed: aiResult.modelUsed,
  });

  // 7. Notificar por Telegram
  const pnlPct = position.side === 'LONG'
    ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

  const telegramMsg = formatPositionManagement(
    data.action,
    position.side,
    currentPrice,
    position.entryPrice,
    position.unrealizedPnl,
    pnlPct,
    currentSL,
    finalNewSL,
    currentTP,
    finalNewTP,
    data.reasoning,
    costs.netBreakeven,
    data.confidence,
  );
  await sendMessage(telegramMsg);

  if (executionError) {
    await sendMessage(`⚠️ Error en ajuste: ${executionError}`);
  }

  return {
    action: data.action,
    executed,
    reason: executionError,
  };
}

/**
 * Valida el SL sugerido por Gemini contra las reglas hardcodeadas
 * Retorna el SL validado o null si no pasa validación
 */
export function validateAndGetSL(
  data: PositionManagementResponse,
  position: PositionData,
  costs: TradeCosts,
  currentPrice: number,
  currentSL: number,
  atr15m?: number,
): number | null {
  const suggestedSL = data.new_stop_loss;
  if (suggestedSL === null) return null;

  const isLong = position.side === 'LONG';

  // Regla 1: Solo mover a favor
  if (isLong && suggestedSL < currentSL) {
    logger.warn(
      { suggested: suggestedSL, current: currentSL },
      'SL rechazado: LONG pero SL baja (aumenta riesgo)',
    );
    return null;
  }
  if (!isLong && suggestedSL > currentSL) {
    logger.warn(
      { suggested: suggestedSL, current: currentSL },
      'SL rechazado: SHORT pero SL sube (aumenta riesgo)',
    );
    return null;
  }

  // Regla 2: Si precio está en contra, no mover
  const priceInFavor = isLong
    ? currentPrice > position.entryPrice
    : currentPrice < position.entryPrice;

  if (!priceInFavor) {
    logger.warn('SL rechazado: precio en contra de la posición');
    return null;
  }

  // Regla 3: Si no cubre costos, max hasta entry price con buffer ATR
  const coversCosts = isLong
    ? currentPrice > costs.netBreakeven
    : currentPrice < costs.netBreakeven;

  if (!coversCosts) {
    const atrBuffer = atr15m ? atr15m * 0.5 : 0;
    const maxAllowed = isLong
      ? position.entryPrice - atrBuffer
      : position.entryPrice + atrBuffer;

    if (isLong && suggestedSL > maxAllowed) {
      logger.info(
        { suggested: suggestedSL, maxAllowed, entryPrice: position.entryPrice, atrBuffer },
        'SL limitado a entry - 0.5×ATR (no cubre costos)',
      );
      return Math.round(maxAllowed * 100) / 100;
    }
    if (!isLong && suggestedSL < maxAllowed) {
      logger.info(
        { suggested: suggestedSL, maxAllowed, entryPrice: position.entryPrice, atrBuffer },
        'SL limitado a entry + 0.5×ATR (no cubre costos)',
      );
      return Math.round(maxAllowed * 100) / 100;
    }
  }

  // Regla 4: SL no puede estar por encima del precio actual (LONG) o debajo (SHORT)
  if (isLong && suggestedSL >= currentPrice) {
    logger.warn('SL rechazado: SL >= precio actual (se ejecutaría inmediatamente)');
    return null;
  }
  if (!isLong && suggestedSL <= currentPrice) {
    logger.warn('SL rechazado: SL <= precio actual (se ejecutaría inmediatamente)');
    return null;
  }

  return Math.round(suggestedSL * 100) / 100;
}


function getAdjustmentType(
  action: string,
  newSL: number | null,
  newTP: number | null,
): 'sl_adjusted' | 'tp_adjusted' | 'sl_tp_adjusted' | 'position_closed' | 'hold' {
  if (action === 'CLOSE') return 'position_closed';
  if (action === 'HOLD') return 'hold';
  if (newSL !== null && newTP !== null) return 'sl_tp_adjusted';
  if (newSL !== null) return 'sl_adjusted';
  if (newTP !== null) return 'tp_adjusted';
  return 'hold';
}
