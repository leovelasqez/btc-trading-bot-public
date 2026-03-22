import { describe, it, expect } from 'vitest';
import {
  formatTradeExecuted,
  formatTradeRejected,
  formatError,
  formatBotStatus,
} from '../../src/notifications/alert-formatter.js';

describe('formatTradeExecuted', () => {
  it('formats LONG trade message', () => {
    const msg = formatTradeExecuted('LONG', 65000, 0.007, 500, 64500, 66000);
    expect(msg).toContain('LONG');
    expect(msg).toContain('65');
    expect(msg).toContain('0.007');
    expect(msg).toContain('500');
    expect(msg).toContain('SL');
    expect(msg).toContain('TP');
  });

  it('formats SHORT trade message', () => {
    const msg = formatTradeExecuted('SHORT', 65000, 0.007, 500, 65500, 64000);
    expect(msg).toContain('SHORT');
  });

  it('handles null take profit', () => {
    const msg = formatTradeExecuted('LONG', 65000, 0.007, 500, 64500, null);
    expect(msg).not.toContain('TP');
  });
});

describe('formatTradeRejected', () => {
  it('includes the reason', () => {
    const msg = formatTradeRejected('low_confidence');
    expect(msg).toContain('low_confidence');
    expect(msg).toContain('rechazada');
  });
});

describe('formatError', () => {
  it('includes the error message', () => {
    const msg = formatError('Connection timeout');
    expect(msg).toContain('Connection timeout');
    expect(msg).toContain('Error');
  });
});

describe('formatBotStatus', () => {
  it('shows active status', () => {
    const msg = formatBotStatus(true, 'semi-auto', 150.50, 3);
    expect(msg).toContain('Activo');
    expect(msg).toContain('semi-auto');
    expect(msg).toContain('150.50');
    expect(msg).toContain('3');
  });

  it('shows paused status', () => {
    const msg = formatBotStatus(false, 'full-auto', -50, 5);
    expect(msg).toContain('Pausado');
    expect(msg).toContain('full-auto');
    expect(msg).toContain('-50');
  });
});
