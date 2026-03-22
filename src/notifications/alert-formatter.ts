/**
 * Formatea mensajes de alerta para Telegram
 */
import type { AiResponse } from '../ai/response-parser.js';
import type { MarketContext } from '../ai/prompt-template.js';

export function formatSignalAlert(
  aiResponse: AiResponse,
  context: MarketContext,
  decisionId: string,
  modelUsed?: string,
): string {
  const { signal, confidence, reasoning, entry_price, stop_loss, take_profit, risk_reward_ratio, warnings } = aiResponse;
  const { currentPrice, indicators, marketData } = context;
  const { tf_15m, tf_1h, tf_4h, tf_1d } = indicators;

  const signalEmoji = signal === 'LONG' ? '🟢 LONG' : signal === 'SHORT' ? '🔴 SHORT' : '⏸️ WAIT';
  const confidenceBar = getConfidenceBar(confidence);

  let msg = `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${signalEmoji}  BTC/USDT Futures\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `💰 Precio: $${currentPrice.toLocaleString()}\n`;
  msg += `📊 Confidence: ${confidence}% ${confidenceBar}\n`;
  msg += `📈 Funding: ${(marketData.markPremium.lastFundingRate * 100).toFixed(4)}%\n`;
  msg += `📉 Premium: ${marketData.markPremium.premiumPct.toFixed(4)}%\n\n`;

  if (entry_price !== null) {
    msg += `🎯 Entry: $${entry_price.toLocaleString()}\n`;
    if (stop_loss !== null) msg += `🛑 Stop Loss: $${stop_loss.toLocaleString()}\n`;
    if (take_profit !== null) msg += `✅ Take Profit: $${take_profit.toLocaleString()}\n`;
    msg += `⚖️ R:R = ${risk_reward_ratio?.toFixed(2) ?? 'N/A'}\n\n`;
  }

  msg += `📝 ${reasoning}\n\n`;

  // Indicadores resumidos (4 timeframes)
  msg += `━━━ Indicadores ━━━\n`;
  const fmtTf = (name: string, tf: typeof tf_15m) => {
    const trend = tf.ema_9 > tf.ema_21 ? '🟢' : '🔴';
    return `${name}: ${trend} RSI ${tf.rsi.toFixed(1)} | Vol ${tf.volume_ratio.toFixed(1)}x`;
  };
  msg += `${fmtTf('15m', tf_15m)}\n`;
  msg += `${fmtTf('1h ', tf_1h)}\n`;
  msg += `${fmtTf('4h ', tf_4h)}\n`;
  msg += `${fmtTf('1d ', tf_1d)}\n\n`;

  // Sentimiento
  msg += `━━━ Sentimiento ━━━\n`;
  msg += `OI: $${(marketData.openInterest.openInterestValue ?? 0).toLocaleString()}\n`;
  if (marketData.longShortRatio) {
    msg += `L/S: ${marketData.longShortRatio.longShortRatio.toFixed(3)}\n`;
  }
  msg += `Book: ${marketData.orderBook.bidAskRatio > 1.1 ? '🟢 Buyers' : marketData.orderBook.bidAskRatio < 0.9 ? '🔴 Sellers' : '⚪ Neutral'}\n\n`;

  if (warnings.length > 0) {
    msg += `⚠️ Warnings:\n`;
    for (const w of warnings) {
      msg += `  • ${w}\n`;
    }
    msg += '\n';
  }

  if (modelUsed) {
    msg += `🤖 ${modelUsed}\n`;
  }
  msg += `🆔 ${decisionId.slice(0, 8)}`;

  return msg;
}

export function formatTradeExecuted(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  quantity: number,
  positionSize: number,
  stopLoss: number,
  takeProfit: number | null,
): string {
  const emoji = side === 'LONG' ? '🟢' : '🔴';
  let msg = `${emoji} Trade ${side} ejecutado\n\n`;
  msg += `Entry: $${entryPrice.toLocaleString()}\n`;
  msg += `Cantidad: ${quantity.toFixed(6)} BTC\n`;
  msg += `Tamaño: $${positionSize.toFixed(2)}\n`;
  msg += `SL: $${stopLoss.toLocaleString()}\n`;
  if (takeProfit !== null) {
    msg += `TP: $${takeProfit.toLocaleString()}\n`;
  }
  return msg;
}

export function formatTradeRejected(reason: string): string {
  return `❌ Señal rechazada: ${reason}`;
}

export function formatError(error: string): string {
  return `🚨 Error del bot:\n${error}`;
}

export function formatBotStatus(
  isRunning: boolean,
  mode: string,
  dailyPnl: number,
  dailyTrades: number,
): string {
  const status = isRunning ? '🟢 Activo' : '🔴 Pausado';
  let msg = `━━━ Bot Status ━━━\n`;
  msg += `Estado: ${status}\n`;
  msg += `Modo: ${mode}\n`;
  msg += `PnL hoy: $${dailyPnl.toFixed(2)}\n`;
  msg += `Trades hoy: ${dailyTrades}\n`;
  return msg;
}

export function formatPositionManagement(
  action: string,
  side: 'LONG' | 'SHORT',
  currentPrice: number,
  entryPrice: number,
  unrealizedPnl: number,
  pnlPct: number,
  previousSL: number | null,
  newSL: number | null,
  previousTP: number | null,
  newTP: number | null,
  reasoning: string,
  netBreakeven: number,
  confidence: number,
): string {
  const sideEmoji = side === 'LONG' ? '🟢' : '🔴';
  const pnlEmoji = unrealizedPnl >= 0 ? '🟢' : '🔴';

  let actionLabel: string;
  switch (action) {
    case 'ADJUST_SL': actionLabel = '🛑 SL Ajustado'; break;
    case 'ADJUST_TP': actionLabel = '🎯 TP Ajustado'; break;
    case 'ADJUST_BOTH': actionLabel = '🔄 SL + TP Ajustados'; break;
    case 'CLOSE': actionLabel = '⛔ Posición Cerrada'; break;
    default: actionLabel = '✋ Posición Mantenida'; break;
  }

  let msg = `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 Gestión de Posición\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${sideEmoji} ${side} BTC/USDT\n`;
  msg += `Entry: $${entryPrice.toLocaleString()} | Actual: $${currentPrice.toLocaleString()}\n`;
  msg += `${pnlEmoji} PnL: $${unrealizedPnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\n`;
  msg += `Breakeven neto: $${netBreakeven.toLocaleString()}\n`;
  msg += `Confidence: ${confidence}% ${getConfidenceBar(confidence)}\n\n`;

  msg += `${actionLabel}\n`;

  if (newSL !== null && previousSL !== null) {
    const slDirection = newSL > previousSL ? '⬆️' : newSL < previousSL ? '⬇️' : '➡️';
    msg += `${slDirection} SL: $${previousSL.toLocaleString()} → $${newSL.toLocaleString()}\n`;
  }

  if (newTP !== null && previousTP !== null) {
    const tpDirection = newTP > previousTP ? '⬆️' : newTP < previousTP ? '⬇️' : '➡️';
    msg += `${tpDirection} TP: $${previousTP.toLocaleString()} → $${newTP.toLocaleString()}\n`;
  } else if (newTP !== null && previousTP === null) {
    msg += `🎯 TP: sin → $${newTP.toLocaleString()}\n`;
  }

  msg += `\n📝 ${reasoning}\n`;

  return msg;
}

export function formatTradeClosed(
  exitReason: 'stop_loss' | 'take_profit' | 'manual' | 'circuit_breaker',
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  pnlUsdt: number,
  pnlPct: number,
  feesUsdt: number,
  stopLoss: number | null,
  takeProfit: number | null,
  openedAt: string | null,
): string {
  const sideEmoji = side === 'LONG' ? '🟢' : '🔴';
  const pnlEmoji = pnlUsdt >= 0 ? '🟢' : '🔴';

  let reasonLabel: string;
  switch (exitReason) {
    case 'stop_loss': reasonLabel = '🛑 Stop Loss Ejecutado'; break;
    case 'take_profit': reasonLabel = '🎯 Take Profit Ejecutado'; break;
    case 'circuit_breaker': reasonLabel = '⚠️ Circuit Breaker'; break;
    default: reasonLabel = '⛔ Posición Cerrada'; break;
  }

  let msg = `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${reasonLabel}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${sideEmoji} ${side} BTC/USDT\n`;
  msg += `Entry: $${entryPrice.toLocaleString()} → Exit: $${exitPrice.toLocaleString()}\n`;
  msg += `📦 ${quantity.toFixed(6)} BTC\n\n`;

  msg += `${pnlEmoji} PnL: $${pnlUsdt >= 0 ? '+' : ''}${pnlUsdt.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\n`;
  msg += `💸 Comisiones: $${feesUsdt.toFixed(2)}\n`;

  const slStr = stopLoss !== null ? `SL: $${stopLoss.toLocaleString()}` : '';
  const tpStr = takeProfit !== null ? `TP: $${takeProfit.toLocaleString()}` : '';
  const levels = [slStr, tpStr].filter(Boolean).join(' | ');
  if (levels) msg += `${levels}\n`;

  if (openedAt) {
    const duration = getPositionDuration(openedAt);
    if (duration) msg += `⏱️ Duración: ${duration}\n`;
  }

  return msg;
}

function getPositionDuration(openedAt: string): string {
  const diffMs = Date.now() - new Date(openedAt).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getConfidenceBar(confidence: number): string {
  const filled = Math.round(confidence / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function formatLimitOrderPlaced(
  side: 'LONG' | 'SHORT',
  limitPrice: number,
  quantity: number,
  positionSize: number,
  stopLoss: number,
  takeProfit: number | null,
): string {
  const emoji = side === 'LONG' ? '🟢' : '🔴';
  let msg = `${emoji} Orden LIMIT ${side} colocada\n\n`;
  msg += `Precio límite: $${limitPrice.toLocaleString()}\n`;
  msg += `Cantidad: ${quantity.toFixed(6)} BTC\n`;
  msg += `Tamaño: $${positionSize.toFixed(2)}\n`;
  msg += `SL: $${stopLoss.toLocaleString()}\n`;
  if (takeProfit !== null) {
    msg += `TP: $${takeProfit.toLocaleString()}\n`;
  }
  msg += `\nSL/TP se colocarán al ejecutarse la orden.`;
  return msg;
}

export function formatLimitOrderFilled(
  side: 'LONG' | 'SHORT',
  avgPrice: number,
  quantity: number,
  stopLoss: number,
  takeProfit: number | null,
  isPartialFill: boolean,
): string {
  const emoji = side === 'LONG' ? '🟢' : '🔴';
  const fillType = isPartialFill ? 'parcialmente ejecutada' : 'ejecutada';
  let msg = `${emoji} Orden LIMIT ${side} ${fillType}\n\n`;
  msg += `Precio promedio: $${avgPrice.toLocaleString()}\n`;
  msg += `Cantidad: ${quantity.toFixed(6)} BTC\n`;
  msg += `SL colocado: $${stopLoss.toLocaleString()}\n`;
  if (takeProfit !== null) {
    msg += `TP colocado: $${takeProfit.toLocaleString()}\n`;
  }
  return msg;
}

export function formatLimitOrderManagement(
  action: string,
  side: 'LONG' | 'SHORT',
  limitPrice: number,
  currentPrice: number,
  reasoning: string,
  confidence: number,
  newOrderType?: string | null,
  newEntryPrice?: number | null,
): string {
  let actionLabel: string;
  switch (action) {
    case 'KEEP': actionLabel = '✋ Orden LIMIT mantenida'; break;
    case 'CANCEL': actionLabel = '❌ Orden LIMIT cancelada'; break;
    case 'REPLACE': actionLabel = `🔄 Orden reemplazada → ${newOrderType}`; break;
    default: actionLabel = action; break;
  }

  const emoji = side === 'LONG' ? '🟢' : '🔴';
  let msg = `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 Gestión de Orden Pendiente\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `${emoji} ${side} BTC/USDT\n`;
  msg += `Límite: $${limitPrice.toLocaleString()} | Actual: $${currentPrice.toLocaleString()}\n`;
  msg += `Confidence: ${confidence}% ${getConfidenceBar(confidence)}\n\n`;
  msg += `${actionLabel}\n`;
  if (action === 'REPLACE' && newEntryPrice !== null && newEntryPrice !== undefined) {
    msg += `Nuevo precio: $${newEntryPrice.toLocaleString()}\n`;
  }
  msg += `\n📝 ${reasoning}\n`;
  return msg;
}

export function formatWaitSignal(
  confidence: number,
  reasoning: string,
  currentPrice: number,
  modelUsed?: string,
): string {
  let msg = `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `⏸️ WAIT  BTC/USDT Futures\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💰 Precio: $${currentPrice.toLocaleString()}\n`;
  msg += `📊 Confidence: ${confidence}%\n\n`;
  msg += `📝 ${reasoning}\n`;
  if (modelUsed) {
    msg += `\n🤖 ${modelUsed}`;
  }
  return msg;
}
