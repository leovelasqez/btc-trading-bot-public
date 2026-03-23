/**
 * Cálculo de indicadores técnicos (7 indicadores en 4 timeframes):
 * 1. Tendencia:   EMA(9/21/50) + EMA(200) filtro macro
 * 2. Momentum:    RSI(14) + MACD(12,26,9)
 * 3. Volatilidad: ATR(14) + Bollinger Bands(20,2)
 * 4. Volumen:     Volume Ratio + OBV + VWAP
 * + Patrones de velas, Soporte/Resistencia, Price Action
 */
import { RSI, EMA, MACD, BollingerBands, OBV, SMA, ATR } from 'technicalindicators';
import * as candlePatterns from 'technicalindicators';
import { INDICATOR_PERIODS } from '../config/constants.js';
import type { Candle } from '../exchange/candles.js';
import type {
  TimeframeIndicators,
  CandleSummary,
  CandlePatterns,
  SupportResistanceLevel,
  PriceActionContext,
} from '../ai/prompt-template.js';

/** Patrones de velas a detectar (curados, los más relevantes) */
const CANDLE_PATTERN_CHECKS: { name: string; fn: (input: { open: number[]; high: number[]; low: number[]; close: number[] }) => boolean }[] = [
  // Reversal bullish
  { name: 'bullish_engulfing', fn: candlePatterns.bullishengulfingpattern },
  { name: 'hammer', fn: candlePatterns.hammerpattern },
  { name: 'morning_star', fn: candlePatterns.morningstar },
  { name: 'morning_doji_star', fn: candlePatterns.morningdojistar },
  { name: 'piercing_line', fn: candlePatterns.piercingline },
  { name: 'three_white_soldiers', fn: candlePatterns.threewhitesoldiers },
  { name: 'bullish_harami', fn: candlePatterns.bullishharami },
  { name: 'tweezer_bottom', fn: candlePatterns.tweezerbottom },
  // Reversal bearish
  { name: 'bearish_engulfing', fn: candlePatterns.bearishengulfingpattern },
  { name: 'hanging_man', fn: candlePatterns.hangingman },
  { name: 'evening_star', fn: candlePatterns.eveningstar },
  { name: 'evening_doji_star', fn: candlePatterns.eveningdojistar },
  { name: 'dark_cloud_cover', fn: candlePatterns.darkcloudcover },
  { name: 'three_black_crows', fn: candlePatterns.threeblackcrows },
  { name: 'bearish_harami', fn: candlePatterns.bearishharami },
  { name: 'tweezer_top', fn: candlePatterns.tweezertop },
  { name: 'shooting_star', fn: candlePatterns.shootingstar },
  // Indecision
  { name: 'doji', fn: candlePatterns.doji },
  { name: 'dragonfly_doji', fn: candlePatterns.dragonflydoji },
  { name: 'gravestone_doji', fn: candlePatterns.gravestonedoji },
];

const SWING_LOOKBACK = 5;
const SR_CLUSTER_PCT = 0.3;
const SR_MAX_LEVELS = 4;

/**
 * Detecta patrones de velas usando las últimas 5 velas
 */
export function detectCandlePatterns(candles: Candle[]): CandlePatterns {
  if (candles.length < 5) return { detected: [] };

  const slice = candles.slice(-5);
  const input = {
    open: slice.map((c) => c.open),
    high: slice.map((c) => c.high),
    low: slice.map((c) => c.low),
    close: slice.map((c) => c.close),
  };

  const detected: string[] = [];
  for (const check of CANDLE_PATTERN_CHECKS) {
    try {
      if (check.fn(input)) {
        detected.push(check.name);
      }
    } catch {
      // Skip pattern if it fails (e.g. insufficient data)
    }
  }

  return { detected };
}

/**
 * Calcula niveles de soporte/resistencia usando swing highs/lows
 */
export function calculateSupportResistance(candles: Candle[], currentPrice: number): SupportResistanceLevel[] {
  if (candles.length < SWING_LOOKBACK * 2 + 1) return [];

  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  // Detect swing points
  for (let i = SWING_LOOKBACK; i < candles.length - SWING_LOOKBACK; i++) {
    const c = candles[i]!;

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= SWING_LOOKBACK; j++) {
      if (candles[i - j]!.high >= c.high || candles[i + j]!.high >= c.high) {
        isSwingHigh = false;
      }
      if (candles[i - j]!.low <= c.low || candles[i + j]!.low <= c.low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) swingHighs.push(c.high);
    if (isSwingLow) swingLows.push(c.low);
  }

  // Cluster nearby levels and count touches
  const clusterLevels = (prices: number[], type: 'support' | 'resistance'): SupportResistanceLevel[] => {
    if (prices.length === 0) return [];

    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: { sum: number; count: number }[] = [];

    for (const price of sorted) {
      const existing = clusters.find(
        (c) => Math.abs(price - c.sum / c.count) / (c.sum / c.count) * 100 < SR_CLUSTER_PCT,
      );
      if (existing) {
        existing.sum += price;
        existing.count++;
      } else {
        clusters.push({ sum: price, count: 1 });
      }
    }

    return clusters
      .map((c) => {
        const avgPrice = Math.round((c.sum / c.count) * 100) / 100;
        return {
          price: avgPrice,
          type,
          touches: c.count,
          distance_pct: Math.round(((avgPrice - currentPrice) / currentPrice) * 10000) / 100,
        };
      })
      .sort((a, b) => b.touches - a.touches)
      .slice(0, SR_MAX_LEVELS);
  };

  const supports = clusterLevels(swingLows, 'support');
  const resistances = clusterLevels(swingHighs, 'resistance');

  return [...supports, ...resistances];
}

/**
 * Calcula contexto de price action (momentum, velocidad, mechas)
 */
export function calculatePriceAction(candles: Candle[], atr: number): PriceActionContext {
  const defaultResult: PriceActionContext = {
    streak: 0,
    velocity: 0,
    biggest_move: { pct: 0, direction: 'up' as const, candles_ago: 0 },
    avg_upper_wick_pct: 0,
    avg_lower_wick_pct: 0,
    range_vs_atr: 0,
  };

  if (candles.length < 5) return defaultResult;

  // Streak: consecutive same-direction candles from most recent
  let streak = 0;
  const lastDir = candles.at(-1)!.close >= candles.at(-1)!.open ? 1 : -1;
  for (let i = candles.length - 1; i >= 0; i--) {
    const dir = candles[i]!.close >= candles[i]!.open ? 1 : -1;
    if (dir === lastDir) streak++;
    else break;
  }
  streak *= lastDir; // positive = bullish streak, negative = bearish

  // Velocity: avg % change per candle over last 5
  const last5 = candles.slice(-5);
  const velocitySum = last5.reduce(
    (sum, c) => sum + ((c.close - c.open) / c.open) * 100,
    0,
  );
  const velocity = Math.round((velocitySum / last5.length) * 1000) / 1000;

  // Biggest single-candle move in last 20
  const last20 = candles.slice(-20);
  let biggestPct = 0;
  let biggestDir: 'up' | 'down' = 'up';
  let biggestAgo = 0;
  for (let i = 0; i < last20.length; i++) {
    const c = last20[i]!;
    const pct = Math.abs((c.close - c.open) / c.open) * 100;
    if (pct > biggestPct) {
      biggestPct = pct;
      biggestDir = c.close >= c.open ? 'up' : 'down';
      biggestAgo = last20.length - 1 - i;
    }
  }

  // Average wick percentages over last 10
  const last10 = candles.slice(-10);
  let upperWickSum = 0;
  let lowerWickSum = 0;
  let wickCount = 0;
  for (const c of last10) {
    const range = c.high - c.low;
    if (range <= 0) continue;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    upperWickSum += (upperWick / range) * 100;
    lowerWickSum += (lowerWick / range) * 100;
    wickCount++;
  }

  // Range vs ATR (last candle)
  const lastCandle = candles.at(-1)!;
  const lastRange = lastCandle.high - lastCandle.low;
  const rangeVsAtr = atr > 0 ? Math.round((lastRange / atr) * 100) / 100 : 0;

  return {
    streak,
    velocity,
    biggest_move: {
      pct: Math.round(biggestPct * 100) / 100,
      direction: biggestDir,
      candles_ago: biggestAgo,
    },
    avg_upper_wick_pct: wickCount > 0 ? Math.round((upperWickSum / wickCount) * 10) / 10 : 0,
    avg_lower_wick_pct: wickCount > 0 ? Math.round((lowerWickSum / wickCount) * 10) / 10 : 0,
    range_vs_atr: rangeVsAtr,
  };
}

export function calculateIndicators(candles: Candle[]): TimeframeIndicators {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  // 1. TREND: EMAs
  const ema9 = EMA.calculate({ values: closes, period: INDICATOR_PERIODS.EMA_FAST });
  const ema21 = EMA.calculate({ values: closes, period: INDICATOR_PERIODS.EMA_MID });
  const ema50 = EMA.calculate({ values: closes, period: INDICATOR_PERIODS.EMA_SLOW });
  const ema200 = EMA.calculate({ values: closes, period: INDICATOR_PERIODS.EMA_LONG });

  // 2. MOMENTUM: RSI + MACD
  const rsiValues = RSI.calculate({ values: closes, period: INDICATOR_PERIODS.RSI });
  const rsi = rsiValues.at(-1) ?? 50;

  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: INDICATOR_PERIODS.MACD_FAST,
    slowPeriod: INDICATOR_PERIODS.MACD_SLOW,
    signalPeriod: INDICATOR_PERIODS.MACD_SIGNAL,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macdLast = macdValues.at(-1);
  const macd = {
    line: macdLast?.MACD ?? 0,
    signal: macdLast?.signal ?? 0,
    histogram: macdLast?.histogram ?? 0,
  };

  // 3. VOLATILITY: ATR + Bollinger Bands
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = atrValues.at(-1) ?? 0;

  const bbValues = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  });
  const bbLast = bbValues.at(-1);
  const bollinger = {
    upper: bbLast?.upper ?? closes.at(-1) ?? 0,
    middle: bbLast?.middle ?? closes.at(-1) ?? 0,
    lower: bbLast?.lower ?? closes.at(-1) ?? 0,
  };

  // 4. VOLUME: Volume Ratio + OBV + VWAP
  const volSma = SMA.calculate({ values: volumes, period: INDICATOR_PERIODS.VOLUME_SMA });
  const currentVolume = volumes.at(-1) ?? 0;
  const avgVolume = volSma.at(-1) ?? 1;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  const obvValues = OBV.calculate({ close: closes, volume: volumes });
  const obv = obvValues.at(-1) ?? 0;

  // VWAP = Σ(typical_price × volume) / Σ(volume) sobre todas las velas disponibles
  let totalTPV = 0;
  let totalVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const tp = (c.high + c.low + c.close) / 3;
    totalTPV += tp * c.volume;
    totalVol += c.volume;
  }
  const vwap = totalVol > 0 ? totalTPV / totalVol : (closes.at(-1) ?? 0);

  // Last 5 candles summary
  const last5: CandleSummary[] = candles.slice(-5).map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  // 5. CANDLE PATTERNS + S/R + PRICE ACTION
  const currentPrice = closes.at(-1) ?? 0;
  const candle_patterns = detectCandlePatterns(candles);
  const support_resistance = calculateSupportResistance(candles, currentPrice);
  const price_action = calculatePriceAction(candles, atr);

  return {
    ema_9: ema9.at(-1) ?? closes.at(-1)!,
    ema_21: ema21.at(-1) ?? closes.at(-1)!,
    ema_50: ema50.at(-1) ?? closes.at(-1)!,
    ema_200: ema200.length > 0 ? ema200.at(-1) : undefined,
    rsi,
    macd,
    atr,
    bollinger,
    volume: currentVolume,
    volume_sma_20: avgVolume,
    volume_ratio: Math.round(volumeRatio * 100) / 100,
    obv: Math.round(obv),
    vwap: Math.round(vwap * 100) / 100,
    last_5_candles: last5,
    candle_patterns,
    support_resistance,
    price_action,
  };
}
