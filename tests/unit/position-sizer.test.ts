import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env before importing
vi.mock('../../src/config/env.js', () => ({
  env: {
    LEVERAGE: 5,
    MAX_POSITION_PCT: 100,
  },
}));

vi.mock('../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { calculatePositionSize } from '../../src/risk/position-sizer.js';

describe('calculatePositionSize', () => {
  it('calculates correct position size with standard params', () => {
    // Balance $1000, entry $65000, SL $64500
    const result = calculatePositionSize(1000, 65000, 64500);

    // Margin = 1000 * 1.00 = $1000
    // Position = 1000 * 5 = $5000
    // Quantity = 5000 / 65000 ≈ 0.076
    expect(result.marginUsdt).toBe(1000);
    expect(result.positionSizeUsdt).toBe(5000);
    expect(result.quantity).toBe(0.076);

    // Risk = |65000 - 64500| * qty = 500 * 0.076923 ≈ 38.46
    expect(result.riskUsdt).toBe(38.46);
    expect(result.riskPct).toBe(3.85);
  });

  it('handles small balance', () => {
    const result = calculatePositionSize(50, 65000, 64000);
    // Margin = 50 * 1.00 = $50
    // Position = 50 * 5 = $250
    // Quantity = 250 / 65000 ≈ 0.003
    expect(result.marginUsdt).toBe(50);
    expect(result.positionSizeUsdt).toBe(250);
    expect(result.quantity).toBe(0.003);
  });

  it('handles very close stop loss', () => {
    const result = calculatePositionSize(1000, 65000, 64990);
    expect(result.riskUsdt).toBeLessThan(1);
  });

  it('handles SHORT direction (SL above entry)', () => {
    const result = calculatePositionSize(1000, 65000, 65500);
    // Should work the same — slDistance = |65000 - 65500| = 500
    expect(result.riskUsdt).toBeGreaterThan(0);
    expect(result.quantity).toBeGreaterThan(0);
  });

  it('returns positive values for all fields', () => {
    const result = calculatePositionSize(5000, 100000, 99000);
    expect(result.quantity).toBeGreaterThanOrEqual(0);
    expect(result.positionSizeUsdt).toBeGreaterThan(0);
    expect(result.marginUsdt).toBeGreaterThan(0);
    expect(result.riskUsdt).toBeGreaterThan(0);
    expect(result.riskPct).toBeGreaterThan(0);
  });

  it('quantity is truncated to 3 decimal places', () => {
    const result = calculatePositionSize(10000, 65000, 64500);
    const decimals = result.quantity.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });
});
