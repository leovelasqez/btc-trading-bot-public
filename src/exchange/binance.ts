import ccxt, { type Exchange } from 'ccxt';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let exchange: Exchange | null = null;

export function getExchange(): Exchange {
  if (exchange) return exchange;

  const isTestnet = env.BINANCE_TESTNET === 'true';

  exchange = new ccxt.binanceusdm({
    apiKey: env.BINANCE_API_KEY,
    secret: env.BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'future',
      adjustForTimeDifference: true,
      // No fetchear currencies (usa sapi que puede estar bloqueado por región)
      fetchCurrencies: false,
    },
  });

  if (isTestnet) {
    // Override solo los endpoints de futures (fapi) al testnet
    const testUrls = exchange.urls['test'] as Record<string, string> | undefined;
    if (testUrls) {
      const apiUrls = exchange.urls['api'] as Record<string, string>;
      for (const key of Object.keys(testUrls)) {
        if (key.startsWith('fapi')) {
          apiUrls[key] = testUrls[key]!;
        }
      }
    }
    logger.info('Binance Futures TESTNET activado');
  } else {
    logger.warn('⚠️  Binance Futures PRODUCCIÓN — dinero real');
  }

  return exchange;
}
