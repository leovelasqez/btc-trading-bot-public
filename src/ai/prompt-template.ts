/**
 * Prompt template para Gemini AI — Análisis técnico optimizado
 * 4 indicadores no correlacionados + datos de microestructura de mercado
 */
import type { MarketDataPackage } from '../exchange/market-data.js';

export interface MarketContext {
  currentPrice: number;
  fundingRate: number;
  balance: number;
  timestamp: string;
  indicators: {
    tf_15m: TimeframeIndicators;
    tf_1h: TimeframeIndicators;
    tf_4h: TimeframeIndicators;
    tf_1d: TimeframeIndicators;
  };
  marketData: MarketDataPackage;
}

export interface TimeframeIndicators {
  // Trend: EMA crossover
  ema_9: number;
  ema_21: number;
  ema_50: number;
  ema_200?: number;
  // Momentum
  rsi: number;
  macd: { line: number; signal: number; histogram: number };
  // Volatility
  atr: number;
  bollinger: { upper: number; middle: number; lower: number };
  // Volume
  volume: number;
  volume_sma_20: number;
  volume_ratio: number;
  obv: number;
  vwap: number;
  // Candle data
  last_5_candles: CandleSummary[];
  // Candle patterns (detected automatically)
  candle_patterns?: CandlePatterns;
  // Support/Resistance levels (swing highs/lows)
  support_resistance?: SupportResistanceLevel[];
  // Price action context (momentum, velocity, wicks)
  price_action?: PriceActionContext;
}

export interface CandleSummary {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlePatterns {
  detected: string[];
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  distance_pct: number;
}

export interface PriceActionContext {
  streak: number;
  velocity: number;
  biggest_move: {
    pct: number;
    direction: 'up' | 'down';
    candles_ago: number;
  };
  avg_upper_wick_pct: number;
  avg_lower_wick_pct: number;
  range_vs_atr: number;
}

export function buildSystemPrompt(): string {
  return `Eres un analista técnico experto en trading de BTC/USDT Perpetual Futures con más de 15 años de experiencia. Tu trabajo es analizar datos de mercado completos para generar señales de trading precisas.

INDICADORES TÉCNICOS (7, en 4 timeframes):
- EMA(9/21/50) para tendencia + EMA(200) como filtro macro
- RSI(14) para momentum y divergencias
- MACD(12,26,9) para momentum y cruces de señal
- ATR(14) para volatilidad y sizing de stops
- Bollinger Bands(20,2) para volatilidad y expansión/contracción
- Volume Ratio + OBV para confirmar convicción y acumulación/distribución
- VWAP como referencia de precio justo institucional

ANÁLISIS DE VELAS Y ESTRUCTURA:
- Patrones de velas detectados automáticamente (doji, engulfing, hammer, morning/evening star, etc.) en cada timeframe
- Soporte/Resistencia calculados desde swing highs/lows (con número de toques = fuerza del nivel)
- Price Action: racha de velas consecutivas, velocidad del movimiento, mayor movimiento reciente, análisis de mechas (rechazo de precio)

DATOS DE MICROESTRUCTURA (señal compuesta):
- Funding Rate + Open Interest → posicionamiento del mercado
- Long/Short Ratios → crowding y señales contrarian
- Liquidaciones → zonas magnéticas de precio
- Order Book → muros de soporte/resistencia inmediatos
- Taker Buy/Sell → presión de compra/venta en tiempo real

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con un JSON válido, sin markdown, sin backticks, sin texto adicional.
2. Si no hay confluencia clara entre indicadores técnicos Y microestructura, responde "WAIT".
3. Sé conservador — es mejor no operar que operar mal.
4. Se usa el 100% del balance como margin en modo CROSS con leverage 5x. Esto significa que un movimiento del 1% contra la posición = 5% de pérdida del balance total. Para calcular el Stop Loss:
   a) Calcula la distancia del SL como 1.5× ATR(14) del timeframe de 15m, colocándolo más allá del swing high más cercano (SHORT) o swing low más cercano (LONG).
   b) Si la distancia resultante supera el 1% del entry price, responde WAIT — el mercado está demasiado volátil para operar con riesgo controlado.
   c) Si la distancia es ≤ 1%, usa ese SL. No ajustes el SL a la baja solo para que parezca "estricto" — un SL dentro del ruido normal del mercado garantiza una pérdida.
5. Siempre considera la tendencia del timeframe mayor (4h y 1d) como la dirección dominante.
6. NUNCA operes contra la tendencia macro. Para que un trade contra 4h Y 1d sea válido, AMBOS timeframes deben mostrar señal de reversión confirmada simultáneamente (divergencia RSI + MACD cruce + vela de reversión). Si solo uno lo muestra, es WAIT.
7. Busca divergencias RSI: si el precio hace nuevo alto pero RSI no, es señal de agotamiento.
8. Volume Ratio > 1.5 confirma el movimiento. Volume Ratio < 0.5 indica falta de convicción.
9. Funding Rate extremo (>0.05% o <-0.05%) es señal contrarian — el mercado está overcrowded.
10. Usa las liquidaciones como zonas magnéticas — el precio tiende a barrer esos niveles.
11. Ratio riesgo/beneficio mínimo 1:2 — el Take Profit debe ser al menos el doble de la distancia al Stop Loss. Si no hay nivel técnico que justifique ese TP, responde WAIT. (Las comisiones de entrada+salida son ~0.08% del notional y deben estar cubiertas por el TP.)

TIPO DE ORDEN (MARKET vs LIMIT):
Cuando la señal es LONG o SHORT, debes elegir entre MARKET o LIMIT:
- Usa "MARKET" cuando: el precio está en el punto ideal de entrada ahora mismo, hay alta urgencia, un breakout está en progreso, o la oportunidad se pierde si esperas.
- Usa "LIMIT" cuando: quieres entrar a un mejor precio, esperas un pullback/retroceso antes de la entrada, o el precio aún no ha llegado a la zona ideal de entrada.
- Cuando order_type es "LIMIT", entry_price es el precio límite donde se colocará la orden.
- Cuando order_type es "MARKET", entry_price es el precio aproximado de entrada actual.
- Para señales WAIT, order_type debe ser null.

ESQUEMA DE RESPUESTA OBLIGATORIO:
{
  "signal": "LONG" | "SHORT" | "WAIT",
  "confidence": 0-100,
  "reasoning": "Explicación detallada de la confluencia técnica y microestructura",
  "order_type": "MARKET" | "LIMIT" | null,
  "entry_price": number,
  "stop_loss": number,
  "take_profit": number,
  "risk_reward_ratio": number,
  "key_levels": {
    "support": [number],
    "resistance": [number]
  },
  "warnings": ["Riesgos identificados"]
}`;
}

export function buildAnalysisPrompt(context: MarketContext): string {
  const { currentPrice, timestamp, balance, indicators, marketData } = context;
  const { tf_15m, tf_1h, tf_4h, tf_1d } = indicators;
  const { orderBook, openInterest, longShortRatio, topTraderLongShortRatio, topTraderPositionRatio, takerVolume, markPremium, recentLiquidations, ticker24h, performance } = marketData;

  return `ANALIZA el siguiente contexto completo de BTC/USDT Perpetual Futures.

━━━━━━━━━━━━━━━━━━━━━━
  CUENTA DE TRADING
━━━━━━━━━━━━━━━━━━━━━━
Balance disponible: $${balance.toFixed(2)} USDT
Margin mode: CROSS (100% del balance en riesgo)
Leverage: 5x
Posición máxima: $${(balance * 5).toFixed(2)} USDT
⚠️ 1% contra la posición = $${(balance * 0.05).toFixed(2)} de pérdida (5% del balance)

━━━━━━━━━━━━━━━━━━━━━━
  DATOS DEL MERCADO
━━━━━━━━━━━━━━━━━━━━━━
Timestamp: ${timestamp}
Precio actual: $${currentPrice.toLocaleString()}
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
Rango 24h: $${(ticker24h.high - ticker24h.low).toFixed(2)} (${ticker24h.high > 0 ? (((ticker24h.high - ticker24h.low) / ticker24h.low) * 100).toFixed(2) : '0'}%)
Volumen 24h: ${ticker24h.volume.toFixed(2)} BTC ($${(ticker24h.quoteVolume / 1e9).toFixed(2)}B USDT)
Cambio 24h: ${ticker24h.changePct >= 0 ? '+' : ''}${ticker24h.changePct.toFixed(2)}%

━━━━━━━━━━━━━━━━━━━━━━
  PERFORMANCE HISTÓRICO
━━━━━━━━━━━━━━━━━━━━━━
7 días: ${performance.change7d >= 0 ? '+' : ''}${performance.change7d.toFixed(2)}%
30 días: ${performance.change30d >= 0 ? '+' : ''}${performance.change30d.toFixed(2)}%
90 días: ${performance.change90d >= 0 ? '+' : ''}${performance.change90d.toFixed(2)}%
180 días: ${performance.change180d >= 0 ? '+' : ''}${performance.change180d.toFixed(2)}%
1 año: ${performance.change1y >= 0 ? '+' : ''}${performance.change1y.toFixed(2)}%

━━━━━━━━━━━━━━━━━━━━━━
  MICROESTRUCTURA DEL MERCADO
━━━━━━━━━━━━━━━━━━━━━━
Open Interest: ${openInterest.openInterestValue.toLocaleString()} USDT (${openInterest.openInterest.toFixed(2)} BTC)
${longShortRatio ? `Long/Short Ratio (global): ${longShortRatio.longShortRatio.toFixed(4)} (Long: ${(longShortRatio.longAccount * 100).toFixed(1)}% / Short: ${(longShortRatio.shortAccount * 100).toFixed(1)}%)` : 'Long/Short Ratio: No disponible'}
${topTraderLongShortRatio ? `Top Traders L/S (cuentas): ${topTraderLongShortRatio.longShortRatio.toFixed(4)} (Long: ${(topTraderLongShortRatio.longAccount * 100).toFixed(1)}% / Short: ${(topTraderLongShortRatio.shortAccount * 100).toFixed(1)}%)` : 'Top Traders L/S: No disponible'}
${topTraderPositionRatio ? `Top Traders L/S (posiciones): ${topTraderPositionRatio.longShortRatio.toFixed(4)} (Long: ${(topTraderPositionRatio.longAccount * 100).toFixed(1)}% / Short: ${(topTraderPositionRatio.shortAccount * 100).toFixed(1)}%)` : 'Top Traders Posiciones: No disponible'}
${takerVolume ? `Taker Buy/Sell Ratio: ${takerVolume.buySellRatio.toFixed(4)} (Buy: ${takerVolume.buyVolume.toFixed(2)} / Sell: ${takerVolume.sellVolume.toFixed(2)})` : 'Taker Volume: No disponible'}

━━━━━━━━━━━━━━━━━━━━━━
  ORDER BOOK (Depth 20)
━━━━━━━━━━━━━━━━━━━━━━
Best Bid: $${orderBook.bestBid.toLocaleString()} | Best Ask: $${orderBook.bestAsk.toLocaleString()}
Spread: $${orderBook.spread.toFixed(2)} (${orderBook.spreadPct}%)
Bid Volume Total: $${orderBook.bidTotalVolume.toLocaleString()} | Ask Volume Total: $${orderBook.askTotalVolume.toLocaleString()}
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
[VOLUMEN] Actual: ${tf.volume.toFixed(0)} | SMA(20): ${tf.volume_sma_20.toFixed(0)} | Ratio: ${tf.volume_ratio.toFixed(2)}x ${tf.volume_ratio > 1.5 ? '⚡ ALTO' : tf.volume_ratio < 0.5 ? '🔇 BAJO' : ''} | OBV: ${tf.obv.toLocaleString()} | VWAP: $${tf.vwap.toFixed(2)}
Precio vs EMAs: ${getPriceEmaRelation(price, tf)}`;
}

function getRsiZone(rsi: number): string {
  if (rsi >= 70) return '⚠️ SOBRECOMPRA';
  if (rsi <= 30) return '⚠️ SOBREVENTA';
  if (rsi >= 60) return '(bullish)';
  if (rsi <= 40) return '(bearish)';
  return '(neutral)';
}

function getPriceEmaRelation(price: number, tf: TimeframeIndicators): string {
  const above = [];
  const below = [];

  if (price > tf.ema_9) above.push('EMA9');
  else below.push('EMA9');
  if (price > tf.ema_21) above.push('EMA21');
  else below.push('EMA21');
  if (price > tf.ema_50) above.push('EMA50');
  else below.push('EMA50');
  if (tf.ema_200) {
    if (price > tf.ema_200) above.push('EMA200');
    else below.push('EMA200');
  }

  const parts = [];
  if (above.length) parts.push(`Por encima de: ${above.join(', ')}`);
  if (below.length) parts.push(`Por debajo de: ${below.join(', ')}`);
  return parts.join(' | ');
}

function describeCandlePattern(candles: CandleSummary[]): string {
  if (!candles.length) return 'Sin datos';

  const directions = candles.map((c) => (c.close > c.open ? '🟢' : '🔴'));
  const bodies = candles.map((c) =>
    Math.abs(((c.close - c.open) / c.open) * 100).toFixed(2)
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
