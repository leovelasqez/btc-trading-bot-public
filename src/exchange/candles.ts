import type { OHLCV } from 'ccxt';
import { getExchange } from './binance.js';
import { SYMBOL, TIMEFRAMES, CANDLE_LIMIT } from '../config/constants.js';
import { logger } from '../config/logger.js';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function parseOHLCV(raw: OHLCV[]): Candle[] {
  return raw.map((c) => ({
    timestamp: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));
}

export async function fetchCandles(
  timeframe: string,
  limit: number = CANDLE_LIMIT,
): Promise<Candle[]> {
  const exchange = getExchange();
  logger.info({ symbol: SYMBOL, timeframe, limit }, 'Fetching candles');

  const raw = await exchange.fetchOHLCV(SYMBOL, timeframe, undefined, limit);
  const candles = parseOHLCV(raw);

  logger.info(
    { timeframe, count: candles.length, lastClose: candles.at(-1)?.close },
    'Candles recibidas',
  );

  return candles;
}

export async function fetchAllTimeframes(): Promise<{
  tf_15m: Candle[];
  tf_1h: Candle[];
  tf_4h: Candle[];
  tf_1d: Candle[];
}> {
  const [tf_15m, tf_1h, tf_4h, tf_1d] = await Promise.all([
    fetchCandles(TIMEFRAMES.SHORT),
    fetchCandles(TIMEFRAMES.MID),
    fetchCandles(TIMEFRAMES.LONG),
    fetchCandles(TIMEFRAMES.DAILY),
  ]);

  return { tf_15m, tf_1h, tf_4h, tf_1d };
}
