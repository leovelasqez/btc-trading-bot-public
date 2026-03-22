/**
 * Constantes del bot — timeframes, indicadores, thresholds
 */

export const SYMBOL = 'BTC/USDT:USDT' as const;

export const TIMEFRAMES = {
  SHORT: '15m',
  MID: '1h',
  LONG: '4h',
  DAILY: '1d',
} as const;

/** Cantidad de velas a fetchear por timeframe */
export const CANDLE_LIMIT = 200;

/** Intervalo de análisis cuando hay posición abierta o limit order pendiente (minutos) */
export const ACTIVE_POSITION_INTERVAL_MINUTES = 15;

/** Periodos para indicadores técnicos */
export const INDICATOR_PERIODS = {
  RSI: 14,
  EMA_FAST: 9,
  EMA_MID: 21,
  EMA_SLOW: 50,
  EMA_LONG: 200,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  VOLUME_SMA: 20,
} as const;
