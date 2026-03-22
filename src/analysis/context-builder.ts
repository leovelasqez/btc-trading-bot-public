/**
 * Empaqueta datos de mercado completos para enviar a Gemini (data-only, sin charts)
 */
import type { Candle } from '../exchange/candles.js';
import type { MarketContext } from '../ai/prompt-template.js';
import type { MarketDataPackage } from '../exchange/market-data.js';
import { calculateIndicators } from './indicators.js';
import { logger } from '../config/logger.js';

export interface AnalysisPackage {
  context: MarketContext;
}

interface BuildContextInput {
  candles_15m: Candle[];
  candles_1h: Candle[];
  candles_4h: Candle[];
  candles_1d: Candle[];
  currentPrice: number;
  fundingRate: number;
  balance: number;
  marketData: MarketDataPackage;
}

export function buildAnalysisPackage(input: BuildContextInput): AnalysisPackage {
  const { candles_15m, candles_1h, candles_4h, candles_1d, currentPrice, fundingRate, balance, marketData } = input;

  logger.info('Calculando indicadores técnicos (4 timeframes)...');
  const tf_15m = calculateIndicators(candles_15m);
  const tf_1h = calculateIndicators(candles_1h);
  const tf_4h = calculateIndicators(candles_4h);
  const tf_1d = calculateIndicators(candles_1d);

  logger.info(
    {
      '15m_rsi': tf_15m.rsi.toFixed(1),
      '1h_rsi': tf_1h.rsi.toFixed(1),
      '4h_rsi': tf_4h.rsi.toFixed(1),
      '1d_rsi': tf_1d.rsi.toFixed(1),
      '15m_trend': tf_15m.ema_9 > tf_15m.ema_21 ? 'UP' : 'DOWN',
      '4h_trend': tf_4h.ema_9 > tf_4h.ema_21 ? 'UP' : 'DOWN',
    },
    'Indicadores calculados',
  );

  // Calcular OI value en USDT si solo tenemos cantidad en BTC
  if (marketData.openInterest.openInterest > 0 && marketData.openInterest.openInterestValue === 0) {
    marketData.openInterest.openInterestValue = Math.round(marketData.openInterest.openInterest * currentPrice);
  }

  const context: MarketContext = {
    currentPrice,
    fundingRate,
    balance,
    timestamp: new Date().toISOString(),
    indicators: { tf_15m, tf_1h, tf_4h, tf_1d },
    marketData,
  };

  return { context };
}
