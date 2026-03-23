/**
 * Prompt template para Gemini AI — Gestión de posición abierta
 * Prompt separado del de análisis de señales, enfocado en ajustar SL/TP o cerrar
 */
import type { MarketContext, TimeframeIndicators, CandleSummary, SupportResistanceLevel } from './prompt-template.js';
import type { PositionData, TradeCosts } from '../exchange/position-data.js';

export function buildPositionManagementSystemPrompt(): string {
  return `Eres un gestor de posiciones experto en BTC/USDT Perpetual Futures con más de 15 años de experiencia. Tu trabajo es analizar una posición abierta junto con los datos de mercado actuales y decidir si ajustar el Stop Loss, Take Profit, cerrar la posición, o mantenerla sin cambios.

TU OBJETIVO PRINCIPAL:
Proteger ganancias y minimizar pérdidas. Un trade que fue ganador NO debería cerrarse en pérdida si se puede evitar.

REGLAS ESTRICTAS PARA STOP LOSS:
1. El SL SOLO se puede mover A FAVOR del trade (nunca aumentar riesgo):
   - LONG: el SL solo puede SUBIR, nunca bajar
   - SHORT: el SL solo puede BAJAR, nunca subir
2. Si el precio actual está POR DEBAJO del precio de entrada (LONG) o POR ENCIMA (SHORT), NO mover el SL.
3. Si el precio actual está POR ENCIMA del precio de entrada pero NO cubre los costos del trade → mover SL máximo hasta el precio de entrada.
4. Si el precio actual está POR ENCIMA del breakeven neto (entrada + costos) → puedes mover el SL hacia el breakeven neto o más allá para proteger ganancias. OBLIGATORIO: usa un buffer de al menos 0.5× ATR(15m) por debajo del nivel objetivo (LONG) o por encima (SHORT) para evitar que el ruido normal del mercado ejecute el SL prematuramente. Ejemplo: si quieres trailing al breakeven, coloca el SL en breakeven − 0.5×ATR(15m) para LONG.
5. Nunca sugieras un SL que viole estas reglas — el sistema lo rechazará.

REGLAS PARA TAKE PROFIT:
- Puedes extender el TP si el momentum y la tendencia lo justifican.
- Puedes acortar el TP si detectas señales de agotamiento o reversión.
- Libertad total en dirección, pero justifica tu decisión.

CUÁNDO CERRAR INMEDIATAMENTE:
- Reversión clara confirmada por múltiples timeframes.
- Divergencia RSI fuerte contra la posición.
- Cambio drástico en microestructura (funding, liquidaciones masivas, OI).
- El mercado muestra señales de crash/pump inminente contra la posición.

CUÁNDO MANTENER (HOLD):
- El trade va según lo esperado, no hay necesidad de ajustar.
- Los indicadores siguen alineados con la dirección del trade.
- No hay señales de reversión.

INDICADORES TÉCNICOS (7, en 4 timeframes):
- EMA(9/21/50) para tendencia + EMA(200) como filtro macro
- RSI(14) para momentum y divergencias
- MACD(12,26,9) para momentum y cruces de señal
- ATR(14) para volatilidad y sizing de stops
- Bollinger Bands(20,2) para volatilidad y expansión/contracción
- OBV para acumulación/distribución histórica
- VWAP como referencia de precio justo institucional

ANÁLISIS DE VELAS Y ESTRUCTURA:
- Patrones de velas detectados automáticamente (doji, engulfing, hammer, etc.)
- Soporte/Resistencia calculados desde swing highs/lows (toques = fuerza del nivel)
- Price Action: racha de velas, velocidad, mayor movimiento, mechas

DATOS DE MICROESTRUCTURA:
- Funding Rate + Open Interest → posicionamiento del mercado
- Long/Short Ratios → crowding y señales contrarian
- Liquidaciones → zonas magnéticas de precio
- Order Book → muros de soporte/resistencia inmediatos
- Taker Buy/Sell → presión de compra/venta en tiempo real

REGLAS DE RESPUESTA:
1. Responde ÚNICAMENTE con un JSON válido, sin markdown, sin backticks, sin texto adicional.
2. Sé conservador — es mejor mantener que ajustar sin razón clara.
3. Si ajustas el SL, asegúrate de que el nuevo valor respeta las reglas anteriores.

ESQUEMA DE RESPUESTA OBLIGATORIO:
{
  "action": "ADJUST_SL" | "ADJUST_TP" | "ADJUST_BOTH" | "CLOSE" | "HOLD",
  "confidence": 0-100,
  "reasoning": "Explicación detallada de por qué tomas esta decisión",
  "new_stop_loss": number | null,
  "new_take_profit": number | null,
  "warnings": ["Riesgos identificados"]
}`;
}

export function buildPositionManagementPrompt(
  context: MarketContext,
  position: PositionData,
  costs: TradeCosts,
  currentSL: number,
  currentTP: number | null,
): string {
  const { currentPrice, timestamp, balance, indicators, marketData } = context;
  const atr15m = indicators.tf_15m.atr;
  const { tf_15m, tf_1h, tf_4h, tf_1d } = indicators;
  const { orderBook, openInterest, longShortRatio, topTraderLongShortRatio, topTraderPositionRatio, takerVolume, markPremium, recentLiquidations, ticker24h } = marketData;

  const pnlPct = position.side === 'LONG'
    ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

  const priceVsEntry = position.side === 'LONG'
    ? currentPrice > position.entryPrice ? 'POR ENCIMA' : 'POR DEBAJO'
    : currentPrice < position.entryPrice ? 'A FAVOR' : 'EN CONTRA';

  const coversCoasts = position.side === 'LONG'
    ? currentPrice > costs.netBreakeven
    : currentPrice < costs.netBreakeven;

  return `GESTIONA la siguiente posición abierta en BTC/USDT Perpetual Futures.

━━━━━━━━━━━━━━━━━━━━━━
  CUENTA DE TRADING
━━━━━━━━━━━━━━━━━━━━━━
Balance disponible: $${balance.toFixed(2)} USDT
Margin mode: CROSS (100% del balance en riesgo)
⚠️ 1% contra la posición = 5% de pérdida del balance total

━━━━━━━━━━━━━━━━━━━━━━
  POSICIÓN ABIERTA
━━━━━━━━━━━━━━━━━━━━━━
Dirección: ${position.side}
Precio de entrada: $${position.entryPrice.toLocaleString()}
Cantidad: ${position.quantity.toFixed(6)} BTC
Tamaño notional: $${position.notional.toLocaleString()}
Leverage: ${position.leverage}x
Margen usado: $${position.marginUsed.toFixed(2)}
Precio de liquidación: $${position.liquidationPrice.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━
  ESTADO ACTUAL
━━━━━━━━━━━━━━━━━━━━━━
Precio actual: $${currentPrice.toLocaleString()}
Mark Price: $${position.markPrice.toLocaleString()}
PnL no realizado: $${position.unrealizedPnl.toFixed(2)} (${pnlPct.toFixed(2)}%)
Precio vs Entry: ${priceVsEntry}

━━━━━━━━━━━━━━━━━━━━━━
  ÓRDENES ACTUALES
━━━━━━━━━━━━━━━━━━━━━━
Stop Loss actual: $${currentSL.toLocaleString()}
Take Profit actual: ${currentTP !== null ? `$${currentTP.toLocaleString()}` : 'No configurado'}

━━━━━━━━━━━━━━━━━━━━━━
  COSTOS DEL TRADE
━━━━━━━━━━━━━━━━━━━━━━
Comisión de entrada: $${costs.entryCommission.toFixed(2)}
Comisión estimada de salida: $${costs.estimatedExitCommission.toFixed(2)}
Funding fees acumulados: $${costs.accumulatedFunding.toFixed(2)}
Costos totales: $${costs.totalCosts.toFixed(2)}
Breakeven neto: $${costs.netBreakeven.toLocaleString()}
¿Cubre costos?: ${coversCoasts ? 'SÍ' : 'NO'}

━━━━━━━━━━━━━━━━━━━━━━
  REGLAS DE SL PARA ESTA POSICIÓN
━━━━━━━━━━━━━━━━━━━━━━
${buildSLRules(position, costs, currentPrice, currentSL, atr15m)}

━━━━━━━━━━━━━━━━━━━━━━
  DATOS DEL MERCADO
━━━━━━━━━━━━━━━━━━━━━━
Timestamp: ${timestamp}
Mark Price: $${markPremium.markPrice.toLocaleString()}
Index Price: $${markPremium.indexPrice.toLocaleString()}
Premium: $${markPremium.premium} (${markPremium.premiumPct.toFixed(4)}%)
Funding Rate: ${(markPremium.lastFundingRate * 100).toFixed(4)}%
Next Funding: ${markPremium.nextFundingTime ? new Date(markPremium.nextFundingTime).toISOString() : 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━
  ESTADÍSTICAS 24H
━━━━━━━━━━━━━━━━━━━━━━
Máximo 24h: $${ticker24h.high.toLocaleString()}
Mínimo 24h: $${ticker24h.low.toLocaleString()}
Volumen 24h: ${ticker24h.volume.toFixed(2)} BTC ($${(ticker24h.quoteVolume / 1e9).toFixed(2)}B USDT)
Cambio 24h: ${ticker24h.changePct >= 0 ? '+' : ''}${ticker24h.changePct.toFixed(2)}%

━━━━━━━━━━━━━━━━━━━━━━
  MICROESTRUCTURA DEL MERCADO
━━━━━━━━━━━━━━━━━━━━━━
Open Interest: ${openInterest.openInterestValue.toLocaleString()} USDT (${openInterest.openInterest.toFixed(2)} BTC)
${longShortRatio ? `Long/Short Ratio (global): ${longShortRatio.longShortRatio.toFixed(4)} (Long: ${(longShortRatio.longAccount * 100).toFixed(1)}% / Short: ${(longShortRatio.shortAccount * 100).toFixed(1)}%)` : 'Long/Short Ratio: No disponible'}
${topTraderLongShortRatio ? `Top Traders L/S (cuentas): ${topTraderLongShortRatio.longShortRatio.toFixed(4)}` : ''}
${topTraderPositionRatio ? `Top Traders L/S (posiciones): ${topTraderPositionRatio.longShortRatio.toFixed(4)}` : ''}
${takerVolume ? `Taker Buy/Sell Ratio: ${takerVolume.buySellRatio.toFixed(4)}` : ''}

━━━━━━━━━━━━━━━━━━━━━━
  ORDER BOOK (Depth 20)
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

${formatTimeframe('15 MINUTOS', tf_15m, currentPrice)}

${formatTimeframe('1 HORA', tf_1h, currentPrice)}

${formatTimeframe('4 HORAS', tf_4h, currentPrice)}

${formatTimeframe('1 DÍA', tf_1d, currentPrice)}

━━━━━━━━━━━━━━━━━━━━━━
  SEÑALES DE VELAS (últimas 5)
━━━━━━━━━━━━━━━━━━━━━━
15m: ${describeCandlePattern(tf_15m.last_5_candles)}
1h:  ${describeCandlePattern(tf_1h.last_5_candles)}
4h:  ${describeCandlePattern(tf_4h.last_5_candles)}
1d:  ${describeCandlePattern(tf_1d.last_5_candles)}

━━━━━━━━━━━━━━━━━━━━━━
  PATRONES DE VELAS DETECTADOS
━━━━━━━━━━━━━━━━━━━━━━
15m: ${formatPatterns(tf_15m)}
1h:  ${formatPatterns(tf_1h)}
4h:  ${formatPatterns(tf_4h)}
1d:  ${formatPatterns(tf_1d)}

━━━━━━━━━━━━━━━━━━━━━━
  SOPORTE/RESISTENCIA (swing highs/lows)
━━━━━━━━━━━━━━━━━━━━━━
${formatSR('15m', tf_15m)}
${formatSR('1h', tf_1h)}
${formatSR('4h', tf_4h)}
${formatSR('1d', tf_1d)}

━━━━━━━━━━━━━━━━━━━━━━
  PRICE ACTION
━━━━━━━━━━━━━━━━━━━━━━
${formatPriceAction('15m', tf_15m)}
${formatPriceAction('1h', tf_1h)}
${formatPriceAction('4h', tf_4h)}
${formatPriceAction('1d', tf_1d)}

Responde ÚNICAMENTE con el JSON especificado en tu system prompt.`;
}

function buildSLRules(
  position: PositionData,
  costs: TradeCosts,
  currentPrice: number,
  currentSL: number,
  atr15m?: number,
): string {
  const isLong = position.side === 'LONG';
  const priceAboveEntry = isLong
    ? currentPrice > position.entryPrice
    : currentPrice < position.entryPrice;
  const coversCosts = isLong
    ? currentPrice > costs.netBreakeven
    : currentPrice < costs.netBreakeven;

  if (!priceAboveEntry) {
    return `- El precio está EN CONTRA de la posición. NO muevas el SL.
- SL actual: $${currentSL.toLocaleString()} (mantener)`;
  }

  if (!coversCosts) {
    return `- El precio está A FAVOR pero NO cubre costos ($${costs.totalCosts.toFixed(2)}).
- Puedes mover el SL hasta máximo: $${position.entryPrice.toLocaleString()} (precio de entrada)
- SL actual: $${currentSL.toLocaleString()}
- ${isLong ? 'El nuevo SL debe ser >= SL actual y <= precio de entrada' : 'El nuevo SL debe ser <= SL actual y >= precio de entrada'}`;
  }

  const atrNote = atr15m
    ? `\n- ATR(15m): $${atr15m.toFixed(2)} → buffer mínimo 0.5×ATR = $${(atr15m * 0.5).toFixed(2)}. ${isLong ? `SL mínimo trailing al breakeven: $${(costs.netBreakeven - atr15m * 0.5).toFixed(2)}` : `SL mínimo trailing al breakeven: $${(costs.netBreakeven + atr15m * 0.5).toFixed(2)}`}`
    : '';

  return `- El precio CUBRE costos. Breakeven neto: $${costs.netBreakeven.toLocaleString()}
- Puedes mover el SL hasta breakeven neto o más allá para proteger ganancias.
- IMPORTANTE: aplica buffer de 0.5×ATR(15m) — no pongas el SL exactamente en el breakeven, sino 0.5×ATR por debajo (LONG) o por encima (SHORT) para evitar ejecución por ruido.${atrNote}
- SL actual: $${currentSL.toLocaleString()}
- ${isLong ? `Rango válido: $${Math.max(currentSL, costs.netBreakeven - (atr15m ?? 0) * 0.5).toLocaleString()} — $${currentPrice.toLocaleString()}` : `Rango válido: $${currentPrice.toLocaleString()} — $${Math.min(currentSL, costs.netBreakeven + (atr15m ?? 0) * 0.5).toLocaleString()}`}`;
}

function formatTimeframe(name: string, tf: TimeframeIndicators, price: number): string {
  const trendDir = tf.ema_9 > tf.ema_21 ? 'ALCISTA' : 'BAJISTA';
  const emaCross = tf.ema_9 > tf.ema_21 ? 'EMA9 > EMA21' : 'EMA9 < EMA21';
  const macdSignal = tf.macd.histogram > 0 ? '(histograma positivo)' : '(histograma negativo)';
  const bbWidth = tf.bollinger.upper - tf.bollinger.lower;
  const bbPos = price < tf.bollinger.lower ? '⬇️ bajo banda inferior' : price > tf.bollinger.upper ? '⬆️ sobre banda superior' : `${(((price - tf.bollinger.lower) / bbWidth) * 100).toFixed(0)}% dentro de banda`;

  return `━━━━━━━━━━━━━━━━━━━━━━
  INDICADORES ${name}
━━━━━━━━━━━━━━━━━━━━━━
[TENDENCIA] EMA(9): $${tf.ema_9.toFixed(2)} | EMA(21): $${tf.ema_21.toFixed(2)} | EMA(50): $${tf.ema_50.toFixed(2)} → ${emaCross} (${trendDir})${tf.ema_200 ? ` | EMA(200): $${tf.ema_200.toFixed(2)} ${price > tf.ema_200 ? '(macro alcista)' : '(macro bajista)'}` : ''}
[MOMENTUM] RSI(14): ${tf.rsi.toFixed(2)} ${getRsiZone(tf.rsi)} | MACD: ${tf.macd.line.toFixed(2)} / Signal: ${tf.macd.signal.toFixed(2)} / Hist: ${tf.macd.histogram.toFixed(2)} ${macdSignal}
[VOLATILIDAD] ATR(14): $${tf.atr.toFixed(2)} | BB Superior: $${tf.bollinger.upper.toFixed(2)} | BB Media: $${tf.bollinger.middle.toFixed(2)} | BB Inferior: $${tf.bollinger.lower.toFixed(2)} → ${bbPos}
[VOLUMEN] Actual: ${tf.volume.toFixed(0)} | SMA(20): ${tf.volume_sma_20.toFixed(0)} | Ratio: ${tf.volume_ratio.toFixed(2)}x ${tf.volume_ratio > 1.5 ? 'ALTO' : tf.volume_ratio < 0.5 ? 'BAJO' : ''} | OBV: ${tf.obv.toLocaleString()} | VWAP: $${tf.vwap.toFixed(2)}`;
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

function formatPatterns(tf: TimeframeIndicators): string {
  if (!tf.candle_patterns || tf.candle_patterns.detected.length === 0) return 'Ninguno detectado';
  return tf.candle_patterns.detected.join(', ');
}

function formatSR(name: string, tf: TimeframeIndicators): string {
  if (!tf.support_resistance || tf.support_resistance.length === 0) return `${name}: Sin niveles detectados`;
  const supports = tf.support_resistance.filter((l) => l.type === 'support');
  const resistances = tf.support_resistance.filter((l) => l.type === 'resistance');
  const fmtLevel = (l: SupportResistanceLevel) => `$${l.price.toLocaleString()} (${l.touches}t, ${l.distance_pct >= 0 ? '+' : ''}${l.distance_pct}%)`;
  const sLine = supports.length > 0 ? `S: ${supports.map(fmtLevel).join(' | ')}` : 'S: —';
  const rLine = resistances.length > 0 ? `R: ${resistances.map(fmtLevel).join(' | ')}` : 'R: —';
  return `${name} ${sLine} / ${rLine}`;
}

function formatPriceAction(name: string, tf: TimeframeIndicators): string {
  if (!tf.price_action) return `${name}: Sin datos`;
  const pa = tf.price_action;
  const streakDir = pa.streak > 0 ? 'alcistas' : pa.streak < 0 ? 'bajistas' : '';
  const streakStr = pa.streak !== 0 ? `Racha: ${Math.abs(pa.streak)} velas ${streakDir}` : 'Racha: 0';
  const velStr = `Vel: ${pa.velocity >= 0 ? '+' : ''}${pa.velocity}%/vela`;
  const bigStr = `Mayor mov: ${pa.biggest_move.direction === 'up' ? '+' : '-'}${pa.biggest_move.pct}% hace ${pa.biggest_move.candles_ago} velas`;
  const wickStr = `Mechas sup: ${pa.avg_upper_wick_pct}% inf: ${pa.avg_lower_wick_pct}%`;
  const rangeStr = `Rango/ATR: ${pa.range_vs_atr}`;
  return `${name}: ${streakStr} | ${velStr} | ${bigStr} | ${wickStr} | ${rangeStr}`;
}
