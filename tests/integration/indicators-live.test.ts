/**
 * Test de integración: fetch candles reales → calcular indicadores
 * Verifica el pipeline completo candles → indicators
 */
import { describe, it, expect, beforeAll } from 'vitest';
import 'dotenv/config';
import { getExchange } from '../../src/exchange/binance.js';
import { fetchCandles } from '../../src/exchange/candles.js';
import { calculateIndicators } from '../../src/analysis/indicators.js';

describe('Live Indicators Pipeline', () => {
  beforeAll(async () => {
    const exchange = getExchange();
    await exchange.loadMarkets();
  });

  it('calculates indicators from real 15m candles', async () => {
    const candles = await fetchCandles('15m', 200);
    const indicators = calculateIndicators(candles);

    expect(indicators.rsi).toBeGreaterThan(0);
    expect(indicators.rsi).toBeLessThan(100);
    expect(indicators.ema_9).toBeGreaterThan(0);
    expect(indicators.ema_21).toBeGreaterThan(0);
    expect(indicators.ema_50).toBeGreaterThan(0);
    expect(indicators.volume).toBeGreaterThanOrEqual(0);
    expect(indicators.last_5_candles).toHaveLength(5);

    // MACD values should be finite
    expect(Number.isFinite(indicators.macd.line)).toBe(true);
    expect(Number.isFinite(indicators.macd.signal)).toBe(true);
    expect(Number.isFinite(indicators.macd.histogram)).toBe(true);
  });

  it('calculates indicators from real 4h candles', async () => {
    const candles = await fetchCandles('4h', 200);
    const indicators = calculateIndicators(candles);

    expect(indicators.rsi).toBeGreaterThan(0);
    expect(indicators.ema_200).toBeDefined();
    expect(indicators.ema_200).toBeGreaterThan(0);
  });
});
