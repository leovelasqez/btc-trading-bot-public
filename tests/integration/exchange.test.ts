/**
 * Tests de integración con Binance Testnet
 * Requiere .env con API keys de testnet válidas
 */
import { describe, it, expect, beforeAll } from 'vitest';
import 'dotenv/config';
import { getExchange } from '../../src/exchange/binance.js';
import { fetchCandles, fetchAllTimeframes } from '../../src/exchange/candles.js';
import { getBalance, setLeverage, cancelAllOrders } from '../../src/exchange/orders.js';

describe('Binance Testnet — Exchange', () => {
  beforeAll(async () => {
    const exchange = getExchange();
    await exchange.loadMarkets();
  });

  it('connects and loads markets', () => {
    const exchange = getExchange();
    expect(exchange.markets).toBeDefined();
    expect(Object.keys(exchange.markets).length).toBeGreaterThan(0);
  });

  it('BTC/USDT:USDT market exists', () => {
    const exchange = getExchange();
    expect(exchange.markets['BTC/USDT:USDT']).toBeDefined();
  });
});

describe('Binance Testnet — Candles', () => {
  beforeAll(async () => {
    const exchange = getExchange();
    await exchange.loadMarkets();
  });

  it('fetches 15m candles', async () => {
    const candles = await fetchCandles('15m', 50);
    expect(candles.length).toBeGreaterThan(0);
    expect(candles.length).toBeLessThanOrEqual(50);

    const first = candles[0]!;
    expect(first.timestamp).toBeGreaterThan(0);
    expect(first.open).toBeGreaterThan(0);
    expect(first.high).toBeGreaterThanOrEqual(first.low);
    expect(first.close).toBeGreaterThan(0);
    expect(first.volume).toBeGreaterThanOrEqual(0);
  });

  it('fetches 4h candles', async () => {
    const candles = await fetchCandles('4h', 50);
    expect(candles.length).toBeGreaterThan(0);
  });

  it('fetchAllTimeframes returns both', async () => {
    const { tf_15m, tf_4h } = await fetchAllTimeframes();
    expect(tf_15m.length).toBeGreaterThan(0);
    expect(tf_4h.length).toBeGreaterThan(0);
  });

  it('candles are sorted by timestamp ascending', async () => {
    const candles = await fetchCandles('15m', 20);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.timestamp).toBeGreaterThanOrEqual(candles[i - 1]!.timestamp);
    }
  });
});

describe('Binance Testnet — Balance & Orders', () => {
  beforeAll(async () => {
    const exchange = getExchange();
    await exchange.loadMarkets();
  });

  it('gets USDT balance', async () => {
    const balance = await getBalance();
    expect(typeof balance).toBe('number');
    expect(balance).toBeGreaterThanOrEqual(0);
  });

  it('sets leverage without error', async () => {
    await expect(setLeverage()).resolves.toBeUndefined();
  });

  it('cancels all orders without error', async () => {
    await expect(cancelAllOrders()).resolves.toBeUndefined();
  });
});
