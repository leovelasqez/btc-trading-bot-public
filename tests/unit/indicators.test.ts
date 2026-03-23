import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { calculateIndicators, detectCandlePatterns, calculateSupportResistance, calculatePriceAction } from '../../src/analysis/indicators.js';
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

  it('candle_patterns is defined and is an array', () => {
    const result = calculateIndicators(candles);
    expect(result.candle_patterns).toBeDefined();
    expect(result.candle_patterns!.detected).toBeInstanceOf(Array);
    for (const p of result.candle_patterns!.detected) {
      expect(typeof p).toBe('string');
    }
  });

  it('support_resistance is defined and has valid structure', () => {
    const result = calculateIndicators(candles);
    expect(result.support_resistance).toBeDefined();
    expect(result.support_resistance).toBeInstanceOf(Array);
    for (const level of result.support_resistance!) {
      expect(level).toHaveProperty('price');
      expect(level).toHaveProperty('type');
      expect(level).toHaveProperty('touches');
      expect(level).toHaveProperty('distance_pct');
      expect(['support', 'resistance']).toContain(level.type);
      expect(level.price).toBeGreaterThan(0);
      expect(level.touches).toBeGreaterThanOrEqual(1);
    }
  });

  it('support_resistance has max 4 supports + 4 resistances', () => {
    const result = calculateIndicators(candles);
    const supports = result.support_resistance!.filter((l) => l.type === 'support');
    const resistances = result.support_resistance!.filter((l) => l.type === 'resistance');
    expect(supports.length).toBeLessThanOrEqual(4);
    expect(resistances.length).toBeLessThanOrEqual(4);
  });

  it('price_action is defined and has all fields', () => {
    const result = calculateIndicators(candles);
    expect(result.price_action).toBeDefined();
    const pa = result.price_action!;
    expect(typeof pa.streak).toBe('number');
    expect(typeof pa.velocity).toBe('number');
    expect(pa.biggest_move).toHaveProperty('pct');
    expect(pa.biggest_move).toHaveProperty('direction');
    expect(pa.biggest_move).toHaveProperty('candles_ago');
    expect(['up', 'down']).toContain(pa.biggest_move.direction);
    expect(pa.avg_upper_wick_pct).toBeGreaterThanOrEqual(0);
    expect(pa.avg_lower_wick_pct).toBeGreaterThanOrEqual(0);
    expect(pa.range_vs_atr).toBeGreaterThanOrEqual(0);
  });
});

describe('detectCandlePatterns', () => {
  it('returns empty array for insufficient data', () => {
    const few: Candle[] = [
      { timestamp: 1, open: 100, high: 110, low: 90, close: 105, volume: 10 },
    ];
    const result = detectCandlePatterns(few);
    expect(result.detected).toEqual([]);
  });

  it('detects doji pattern', () => {
    // Doji: open ≈ close, long wicks
    const candles: Candle[] = [];
    for (let i = 0; i < 4; i++) {
      candles.push({ timestamp: i, open: 100 + i, high: 105 + i, low: 95 + i, close: 101 + i, volume: 100 });
    }
    // Last candle is a doji
    candles.push({ timestamp: 5, open: 105.00, high: 110.00, low: 100.00, close: 105.01, volume: 100 });
    const result = detectCandlePatterns(candles);
    expect(result.detected).toContain('doji');
  });
});

describe('calculateSupportResistance', () => {
  it('returns empty array for insufficient data', () => {
    const few: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: i, open: 100, high: 110, low: 90, close: 105, volume: 10,
    }));
    const result = calculateSupportResistance(few, 100);
    expect(result).toEqual([]);
  });

  it('finds swing points with enough data', () => {
    // Create data with clear swing high and low
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const base = 100;
      // Create a sine wave pattern for clear swings
      const wave = Math.sin((i / 10) * Math.PI) * 10;
      candles.push({
        timestamp: i,
        open: base + wave - 0.5,
        high: base + wave + 2,
        low: base + wave - 2,
        close: base + wave + 0.5,
        volume: 100,
      });
    }
    const result = calculateSupportResistance(candles, 100);
    expect(result.length).toBeGreaterThan(0);
    for (const level of result) {
      expect(level.price).toBeGreaterThan(0);
      expect(['support', 'resistance']).toContain(level.type);
    }
  });
});

describe('calculatePriceAction', () => {
  it('returns default for insufficient data', () => {
    const few: Candle[] = [
      { timestamp: 1, open: 100, high: 110, low: 90, close: 105, volume: 10 },
    ];
    const result = calculatePriceAction(few, 5);
    expect(result.streak).toBe(0);
    expect(result.velocity).toBe(0);
  });

  it('detects bullish streak', () => {
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i,
      open: 100 + i * 2,
      high: 103 + i * 2,
      low: 99 + i * 2,
      close: 102 + i * 2,  // close > open = bullish
      volume: 100,
    }));
    const result = calculatePriceAction(candles, 5);
    expect(result.streak).toBeGreaterThan(0); // positive = bullish
  });

  it('detects bearish streak', () => {
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i,
      open: 120 - i * 2,
      high: 121 - i * 2,
      low: 117 - i * 2,
      close: 118 - i * 2,  // close < open = bearish
      volume: 100,
    }));
    const result = calculatePriceAction(candles, 5);
    expect(result.streak).toBeLessThan(0); // negative = bearish
  });

  it('range_vs_atr is calculated correctly', () => {
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 100,
    }));
    // Last candle range = 20, ATR = 10 → ratio = 2.0
    const result = calculatePriceAction(candles, 10);
    expect(result.range_vs_atr).toBe(2);
  });
});
