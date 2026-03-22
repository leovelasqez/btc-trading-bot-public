/**
 * Cálculo de indicadores técnicos (7 indicadores en 4 timeframes):
 * 1. Tendencia:   EMA(9/21/50) + EMA(200) filtro macro
 * 2. Momentum:    RSI(14) + MACD(12,26,9)
 * 3. Volatilidad: ATR(14) + Bollinger Bands(20,2)
 * 4. Volumen:     Volume Ratio + OBV + VWAP
 */
import { RSI, EMA, MACD, BollingerBands, OBV, SMA, ATR } from 'technicalindicators';
import { INDICATOR_PERIODS } from '../config/constants.js';
import type { Candle } from '../exchange/candles.js';
import type { TimeframeIndicators, CandleSummary } from '../ai/prompt-template.js';

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
  };
}
