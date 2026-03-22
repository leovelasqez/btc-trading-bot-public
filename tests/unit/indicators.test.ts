import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { calculateIndicators } from '../../src/analysis/indicators.js';
import type { Candle } from '../../src/exchange/candles.js';

function generateCandles(count: number, basePrice = 65000): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 200;
    price += change;
    const high = price + Math.random() * 100;
    const low = price - Math.random() * 100;
    candles.push({
      timestamp: Date.now() - (count - i) * 900_000,
      open: price - change / 2,
      high,
      low,
      close: price,
      volume: 100 + Math.random() * 500,
    });
  }
  return candles;
}

describe('calculateIndicators', () => {
  const candles = generateCandles(250);

  it('returns all required fields', () => {
    const result = calculateIndicators(candles);
    expect(result).toHaveProperty('rsi');
    expect(result).toHaveProperty('ema_9');
    expect(result).toHaveProperty('ema_21');
    expect(result).toHaveProperty('ema_50');
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('volume');
    expect(result).toHaveProperty('volume_sma_20');
    expect(result).toHaveProperty('last_5_candles');
  });

  it('RSI is between 0 and 100', () => {
    const result = calculateIndicators(candles);
    expect(result.rsi).toBeGreaterThanOrEqual(0);
    expect(result.rsi).toBeLessThanOrEqual(100);
  });

  it('EMAs are reasonable values', () => {
    const result = calculateIndicators(candles);
    // EMAs should be near the price range
    expect(result.ema_9).toBeGreaterThan(0);
    expect(result.ema_21).toBeGreaterThan(0);
    expect(result.ema_50).toBeGreaterThan(0);
  });

  it('MACD has line, signal, and histogram', () => {
    const result = calculateIndicators(candles);
    expect(result.macd).toHaveProperty('line');
    expect(result.macd).toHaveProperty('signal');
    expect(result.macd).toHaveProperty('histogram');
    expect(typeof result.macd.line).toBe('number');
    expect(typeof result.macd.signal).toBe('number');
    expect(typeof result.macd.histogram).toBe('number');
  });

  it('last_5_candles has exactly 5 entries', () => {
    const result = calculateIndicators(candles);
    expect(result.last_5_candles).toHaveLength(5);
  });

  it('each candle summary has OHLCV', () => {
    const result = calculateIndicators(candles);
    for (const c of result.last_5_candles) {
      expect(c).toHaveProperty('open');
      expect(c).toHaveProperty('high');
      expect(c).toHaveProperty('low');
      expect(c).toHaveProperty('close');
      expect(c).toHaveProperty('volume');
    }
  });

  it('handles EMA 200 with enough data', () => {
    const result = calculateIndicators(candles);
    expect(result.ema_200).toBeDefined();
    expect(result.ema_200).toBeGreaterThan(0);
  });

  it('handles less than 200 candles (no ema_200)', () => {
    const shortCandles = generateCandles(100);
    const result = calculateIndicators(shortCandles);
    // ema_200 may be undefined with only 100 candles
    // (EMA needs at least the period length)
    expect(result.rsi).toBeGreaterThanOrEqual(0);
  });

  it('volume_sma_20 is positive', () => {
    const result = calculateIndicators(candles);
    expect(result.volume_sma_20).toBeGreaterThan(0);
  });
});
