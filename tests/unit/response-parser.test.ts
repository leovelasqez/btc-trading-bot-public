import { describe, it, expect } from 'vitest';
import { parseAiResponse } from '../../src/ai/response-parser.js';

describe('parseAiResponse', () => {
  const validLong = {
    signal: 'LONG',
    confidence: 85,
    reasoning: 'Bullish momentum detected with EMA crossover on 15m and 4h alignment',
    entry_price: 65000,
    stop_loss: 64500,
    take_profit: 66000,
    risk_reward_ratio: 2.0,
    key_levels: { support: [64000, 63500], resistance: [66000, 67000] },
    warnings: [],
  };

  const validShort = {
    signal: 'SHORT',
    confidence: 78,
    reasoning: 'Bearish divergence on RSI with rejection at resistance level',
    entry_price: 65000,
    stop_loss: 65500,
    take_profit: 64000,
    risk_reward_ratio: 2.0,
    key_levels: { support: [64000], resistance: [65500, 66000] },
    warnings: ['High funding rate'],
  };

  const validWait = {
    signal: 'WAIT',
    confidence: 30,
    reasoning: 'No clear directional bias, market is ranging between support and resistance',
    entry_price: null,
    stop_loss: null,
    take_profit: null,
    risk_reward_ratio: null,
    key_levels: { support: [64000], resistance: [66000] },
    warnings: [],
  };

  it('parses valid LONG signal', () => {
    const result = parseAiResponse(JSON.stringify(validLong));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signal).toBe('LONG');
      expect(result.data.confidence).toBe(85);
      expect(result.data.entry_price).toBe(65000);
    }
  });

  it('parses valid SHORT signal', () => {
    const result = parseAiResponse(JSON.stringify(validShort));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signal).toBe('SHORT');
      expect(result.data.warnings).toContain('High funding rate');
    }
  });

  it('parses valid WAIT signal with null prices', () => {
    const result = parseAiResponse(JSON.stringify(validWait));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signal).toBe('WAIT');
      expect(result.data.entry_price).toBeNull();
      expect(result.data.stop_loss).toBeNull();
      expect(result.data.take_profit).toBeNull();
    }
  });

  it('handles JSON wrapped in markdown code block', () => {
    const wrapped = '```json\n' + JSON.stringify(validLong) + '\n```';
    const result = parseAiResponse(wrapped);
    expect(result.success).toBe(true);
  });

  it('handles JSON with extra text around it', () => {
    const withText = 'Here is my analysis:\n' + JSON.stringify(validLong) + '\nHope this helps!';
    const result = parseAiResponse(withText);
    expect(result.success).toBe(true);
  });

  it('rejects LONG with stop_loss >= entry_price', () => {
    const bad = { ...validLong, stop_loss: 65500 };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('stop_loss >= entry_price');
    }
  });

  it('rejects LONG with take_profit <= entry_price', () => {
    const bad = { ...validLong, take_profit: 64000 };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('take_profit <= entry_price');
    }
  });

  it('rejects SHORT with stop_loss <= entry_price', () => {
    const bad = { ...validShort, stop_loss: 64500 };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('stop_loss <= entry_price');
    }
  });

  it('rejects SHORT with take_profit >= entry_price', () => {
    const bad = { ...validShort, take_profit: 66000 };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('take_profit >= entry_price');
    }
  });

  it('rejects LONG signal with null prices', () => {
    const bad = { ...validLong, entry_price: null, stop_loss: null, take_profit: null };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('requiere entry_price');
    }
  });

  it('rejects invalid JSON', () => {
    const result = parseAiResponse('not json at all');
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0-100', () => {
    const bad = { ...validLong, confidence: 150 };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = parseAiResponse(JSON.stringify({ signal: 'WAIT' }));
    expect(result.success).toBe(false);
  });

  it('rejects invalid signal type', () => {
    const bad = { ...validLong, signal: 'BUY' };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
  });

  it('rejects reasoning that is too short', () => {
    const bad = { ...validLong, reasoning: 'short' };
    const result = parseAiResponse(JSON.stringify(bad));
    expect(result.success).toBe(false);
  });
});
