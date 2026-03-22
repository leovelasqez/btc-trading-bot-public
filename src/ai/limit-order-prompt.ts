/**
 * Prompt template para Gemini AI — Gestión de orden límite pendiente
 * Prompt separado para decidir si mantener, cancelar o reemplazar una orden límite no ejecutada
 */
import type { MarketContext, TimeframeIndicators, CandleSummary } from './prompt-template.js';

export interface PendingLimitOrder {
  side: 'LONG' | 'SHORT';
  limitPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number | null;
  placedAt: string; // ISO timestamp
  orderId: string;
}

export function buildLimitOrderManagementSystemPrompt(): string {
  return `Eres un gestor de órdenes experto en BTC/USDT Perpetual Futures con más de 15 años de experiencia. Tu trabajo es analizar una orden límite pendiente (aún no ejecutada) junto con los datos de mercado actuales y decidir qué hacer con ella.

TU OBJETIVO PRINCIPAL:
Determinar si la orden límite pendiente sigue siendo una buena entrada o si las condiciones de mercado han cambiado y la orden debe cancelarse o reemplazarse.

ACCIONES DISPONIBLES:
- KEEP: Mantener la orden límite tal cual. El setup sigue siendo válido, el precio podría llegar al nivel de la orden.
- CANCEL: Cancelar la orden. El setup ya no es válido, el mercado se movió demasiado lejos, o la tendencia cambió.
- REPLACE: Cancelar la orden actual y colocar una nueva. El setup sigue siendo válido pero a un nivel diferente, o se justifica cambiar a orden de mercado.

CRITERIOS DE DECISIÓN:
1. ¿El precio se ha alejado significativamente del precio límite? Si sí, ¿es probable que regrese?
2. ¿Ha cambiado la tendencia desde que se colocó la orden? Revisa indicadores en múltiples timeframes.
3. ¿Los indicadores de microestructura (funding, OI, liquidaciones) siguen apoyando la dirección?
4. ¿Cuánto tiempo ha pasado desde que se colocó la orden? Órdenes muy viejas pierden relevancia.
5. ¿Hay un mejor nivel de entrada disponible ahora?
6. ¿El mercado muestra señales de reversión contra la dirección de la orden?

REGLAS PARA REPLACE:
- Si REPLACE con MARKET: new_entry_price es el precio aproximado de entrada actual.
- Si REPLACE con LIMIT: new_entry_price es el nuevo precio límite.
- SIEMPRE incluir new_stop_loss y opcionalmente new_take_profit.
- Validaciones de SL:
  - LONG: stop_loss < entry_price, take_profit > entry_price
  - SHORT: stop_loss > entry_price, take_profit < entry_price

REGLAS DE RESPUESTA:
1. Responde ÚNICAMENTE con un JSON válido, sin markdown, sin backticks, sin texto adicional.
2. Sé conservador — si la orden sigue siendo razonable, KEEP.
3. Para KEEP y CANCEL: todos los campos new_* deben ser null.
4. Para REPLACE: new_order_type, new_entry_price y new_stop_loss son obligatorios.

ESQUEMA DE RESPUESTA OBLIGATORIO:
{
  "action": "KEEP" | "CANCEL" | "REPLACE",
  "confidence": 0-100,
  "reasoning": "Explicación detallada de por qué tomas esta decisión",
  "new_order_type": "MARKET" | "LIMIT" | null,
  "new_entry_price": number | null,
  "new_stop_loss": number | null,
  "new_take_profit": number | null,
  "new_risk_reward_ratio": number | null,
  "warnings": ["Riesgos identificados"]
}`;
}

export function buildLimitOrderManagementPrompt(
  context: MarketContext,
  pendingOrder: PendingLimitOrder,
): string {
  const { currentPrice, timestamp, balance, indicators, marketData } = context;
  const { tf_15m, tf_1h, tf_4h, tf_1d } = indicators;
  const { orderBook, openInterest, longShortRatio, takerVolume, markPremium, recentLiquidations } = marketData;

  const distanceFromLimit = currentPrice - pendingOrder.limitPrice;
  const distancePct = (distanceFromLimit / pendingOrder.limitPrice) * 100;
  const distanceDir = distanceFromLimit > 0 ? 'por encima' : 'por debajo';

  const placedTime = new Date(pendingOrder.placedAt);
  const now = new Date(timestamp);
  const elapsedMs = now.getTime() - placedTime.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const elapsedStr = elapsedHours > 0
    ? `${elapsedHours}h ${elapsedMinutes % 60}m`
    : `${elapsedMinutes}m`;

  return `EVALÚA la siguiente orden límite pendiente en BTC/USDT Perpetual Futures.

━━━━━━━━━━━━━━━━━━━━━━
  CUENTA DE TRADING
━━━━━━━━━━━━━━━━━━━━━━
Balance disponible: $${balance.toFixed(2)} USDT
Margin mode: CROSS (100% del balance en riesgo)
Leverage: 5x
⚠️ 1% contra la posición = 5% de pérdida del balance total

━━━━━━━━━━━━━━━━━━━━━━
  ORDEN PENDIENTE
━━━━━━━━━━━━━━━━━━━━━━
Dirección: ${pendingOrder.side}
Precio límite: $${pendingOrder.limitPrice.toLocaleString()}
Cantidad: ${pendingOrder.quantity.toFixed(6)} BTC
Stop Loss: $${pendingOrder.stopLoss.toLocaleString()}
Take Profit: ${pendingOrder.takeProfit !== null ? `$${pendingOrder.takeProfit.toLocaleString()}` : 'No configurado'}
Order ID: ${pendingOrder.orderId}
Colocada: ${pendingOrder.placedAt}
Tiempo transcurrido: ${elapsedStr}

━━━━━━━━━━━━━━━━━━━━━━
  PRECIO ACTUAL VS ORDEN
━━━━━━━━━━━━━━━━━━━━━━
Precio actual: $${currentPrice.toLocaleString()}
Distancia al límite: $${Math.abs(distanceFromLimit).toFixed(2)} ${distanceDir} (${Math.abs(distancePct).toFixed(2)}%)
${pendingOrder.side === 'LONG'
    ? currentPrice > pendingOrder.limitPrice
      ? 'El precio está POR ENCIMA del límite — la orden NO se ejecutará a menos que el precio baje.'
      : 'El precio está POR DEBAJO del límite — la orden podría ejecutarse pronto.'
    : currentPrice < pendingOrder.limitPrice
      ? 'El precio está POR DEBAJO del límite — la orden NO se ejecutará a menos que el precio suba.'
      : 'El precio está POR ENCIMA del límite — la orden podría ejecutarse pronto.'}

━━━━━━━━━━━━━━━━━━━━━━
  DATOS DEL MERCADO
━━━━━━━━━━━━━━━━━━━━━━
Timestamp: ${timestamp}
Mark Price: $${markPremium.markPrice.toLocaleString()}
Funding Rate: ${(markPremium.lastFundingRate * 100).toFixed(4)}%
Open Interest: ${openInterest.openInterestValue.toLocaleString()} USDT
${longShortRatio ? `Long/Short Ratio: ${longShortRatio.longShortRatio.toFixed(4)} (L: ${(longShortRatio.longAccount * 100).toFixed(1)}% / S: ${(longShortRatio.shortAccount * 100).toFixed(1)}%)` : 'Long/Short Ratio: No disponible'}
${takerVolume ? `Taker Buy/Sell Ratio: ${takerVolume.buySellRatio.toFixed(4)}` : 'Taker Volume: No disponible'}

━━━━━━━━━━━━━━━━━━━━━━
  ORDER BOOK
━━━━━━━━━━━━━━━━━━━━━━
Best Bid: $${orderBook.bestBid.toLocaleString()} | Best Ask: $${orderBook.bestAsk.toLocaleString()}
Spread: $${orderBook.spread.toFixed(2)} (${orderBook.spreadPct}%)
Bid/Ask Ratio: ${orderBook.bidAskRatio} ${orderBook.bidAskRatio > 1.2 ? '(compradores dominan)' : orderBook.bidAskRatio < 0.8 ? '(vendedores dominan)' : '(equilibrado)'}
Bid Walls: ${orderBook.bidWalls.map(w => `$${w.price.toLocaleString()} (${w.quantity.toFixed(3)} BTC)`).join(', ')}
Ask Walls: ${orderBook.askWalls.map(w => `$${w.price.toLocaleString()} (${w.quantity.toFixed(3)} BTC)`).join(', ')}

━━━━━━━━━━━━━━━━━━━━━━
  LIQUIDACIONES RECIENTES
━━━━━━━━━━━━━━━━━━━━━━
${recentLiquidations.length > 0 ? recentLiquidations.map(l => `${l.side === 'BUY' ? 'SHORT liquidado' : 'LONG liquidado'} @ $${l.price.toLocaleString()} (${l.quantity.toFixed(4)} BTC)`).join('\n') : 'Sin liquidaciones recientes'}

━━━━━━━━━━━━━━━━━━━━━━
  INDICADORES TÉCNICOS (resumen)
━━━━━━━━━━━━━━━━━━━━━━
${formatTimeframeSummary('15m', tf_15m, currentPrice)}
${formatTimeframeSummary('1h', tf_1h, currentPrice)}
${formatTimeframeSummary('4h', tf_4h, currentPrice)}
${formatTimeframeSummary('1d', tf_1d, currentPrice)}

━━━━━━━━━━━━━━━━━━━━━━
  SEÑALES DE VELAS (últimas 5)
━━━━━━━━━━━━━━━━━━━━━━
15m: ${describeCandlePattern(tf_15m.last_5_candles)}
1h:  ${describeCandlePattern(tf_1h.last_5_candles)}
4h:  ${describeCandlePattern(tf_4h.last_5_candles)}
1d:  ${describeCandlePattern(tf_1d.last_5_candles)}

Responde ÚNICAMENTE con el JSON especificado en tu system prompt.`;
}

function formatTimeframeSummary(name: string, tf: TimeframeIndicators, price: number): string {
  const trend = tf.ema_9 > tf.ema_21 ? 'ALCISTA' : 'BAJISTA';
  const rsiZone = getRsiZone(tf.rsi);
  const ema200Note = tf.ema_200
    ? ` | EMA200: ${price > tf.ema_200 ? 'encima' : 'debajo'}`
    : '';

  return `[${name}] Tendencia: ${trend} (EMA9: $${tf.ema_9.toFixed(2)}, EMA21: $${tf.ema_21.toFixed(2)}${ema200Note}) | RSI: ${tf.rsi.toFixed(1)} ${rsiZone} | ATR: $${tf.atr.toFixed(2)} | Vol: ${tf.volume_ratio.toFixed(2)}x`;
}

function getRsiZone(rsi: number): string {
  if (rsi >= 70) return 'SOBRECOMPRA';
  if (rsi <= 30) return 'SOBREVENTA';
  if (rsi >= 60) return '(bullish)';
  if (rsi <= 40) return '(bearish)';
  return '(neutral)';
}

function describeCandlePattern(candles: CandleSummary[]): string {
  if (!candles.length) return 'Sin datos';
  const directions = candles.map((c) => (c.close > c.open ? '+' : '-'));
  const bodies = candles.map((c) =>
    Math.abs(((c.close - c.open) / c.open) * 100).toFixed(2),
  );
  return `${directions.join('')} (cuerpos: ${bodies.map((b) => b + '%').join(', ')})`;
}
