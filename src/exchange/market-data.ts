/**
 * Market Data — datos avanzados de Binance Futures
 * Order book, open interest, long/short ratios, liquidaciones, etc.
 */
import { getExchange } from './binance.js';
import { SYMBOL } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { getRecentLiquidations } from './liquidation-ws.js';

// ─── Types ───

export interface OrderBookSummary {
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPct: number;
  bidWalls: { price: number; quantity: number }[];
  askWalls: { price: number; quantity: number }[];
  bidTotalVolume: number;
  askTotalVolume: number;
  bidAskRatio: number;
}

export interface OpenInterestData {
  openInterest: number;
  openInterestValue: number;
}

export interface LongShortRatio {
  longAccount: number;
  shortAccount: number;
  longShortRatio: number;
}

export interface TakerVolume {
  buyVolume: number;
  sellVolume: number;
  buySellRatio: number;
}

export interface MarkPremium {
  markPrice: number;
  indexPrice: number;
  estimatedSettlePrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  interestRate: number;
  premium: number;
  premiumPct: number;
}

export interface Ticker24h {
  high: number;
  low: number;
  volume: number;        // BTC
  quoteVolume: number;   // USDT
  changePct: number;     // % change 24h
  prevClose: number;
}

export interface PricePerformance {
  change7d: number;
  change30d: number;
  change90d: number;
  change180d: number;
  change1y: number;
}

export interface MarketDataPackage {
  orderBook: OrderBookSummary;
  openInterest: OpenInterestData;
  longShortRatio: LongShortRatio | null;
  topTraderLongShortRatio: LongShortRatio | null;
  topTraderPositionRatio: LongShortRatio | null;
  takerVolume: TakerVolume | null;
  markPremium: MarkPremium;
  recentLiquidations: { side: string; price: number; quantity: number; time: number }[];
  ticker24h: Ticker24h;
  performance: PricePerformance;
}

// ─── Order Book ───

export async function fetchOrderBook(depth = 20): Promise<OrderBookSummary> {
  const exchange = getExchange();
  const book = await exchange.fetchOrderBook(SYMBOL, depth);

  const bestBid = book.bids[0]?.[0] ?? 0;
  const bestAsk = book.asks[0]?.[0] ?? 0;
  const spread = bestAsk - bestBid;
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0;

  // Find walls (top 3 largest orders on each side)
  const bidEntries = (book.bids ?? []).map(([price, qty]) => ({ price: price!, quantity: qty! }));
  const askEntries = (book.asks ?? []).map(([price, qty]) => ({ price: price!, quantity: qty! }));

  const bidWalls = [...bidEntries].sort((a, b) => b.quantity - a.quantity).slice(0, 3);
  const askWalls = [...askEntries].sort((a, b) => b.quantity - a.quantity).slice(0, 3);

  const bidTotalVolume = bidEntries.reduce((sum, e) => sum + e.price * e.quantity, 0);
  const askTotalVolume = askEntries.reduce((sum, e) => sum + e.price * e.quantity, 0);
  const bidAskRatio = askTotalVolume > 0 ? bidTotalVolume / askTotalVolume : 1;

  return {
    bestBid, bestAsk, spread,
    spreadPct: Math.round(spreadPct * 10000) / 10000,
    bidWalls, askWalls,
    bidTotalVolume: Math.round(bidTotalVolume),
    askTotalVolume: Math.round(askTotalVolume),
    bidAskRatio: Math.round(bidAskRatio * 100) / 100,
  };
}

// ─── Open Interest ───

export async function fetchOpenInterest(): Promise<OpenInterestData> {
  try {
    const data = await fetchBinanceFapi(
      '/fapi/v1/openInterest?symbol=BTCUSDT'
    ) as { openInterest: string; time: number } | null;

    if (!data) return { openInterest: 0, openInterestValue: 0 };

    const oi = parseFloat(data.openInterest);
    return {
      openInterest: oi,
      openInterestValue: 0, // Se calcula después con precio actual
    };
  } catch {
    logger.warn('No se pudo obtener Open Interest');
    return { openInterest: 0, openInterestValue: 0 };
  }
}

// ─── Long/Short Ratios (via Binance fapi) ───

async function fetchBinanceFapi(endpoint: string): Promise<unknown> {
  const exchange = getExchange();
  const isTestnet = (exchange.urls['api'] as Record<string, string>)['fapiPublic']?.includes('testnet');
  const baseUrl = isTestnet
    ? 'https://testnet.binancefuture.com'
    : 'https://fapi.binance.com';

  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

export async function fetchLongShortRatio(): Promise<LongShortRatio | null> {
  try {
    const data = await fetchBinanceFapi(
      '/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1'
    ) as { longAccount: string; shortAccount: string; longShortRatio: string }[] | null;

    if (!data || !data[0]) return null;
    return {
      longAccount: parseFloat(data[0].longAccount),
      shortAccount: parseFloat(data[0].shortAccount),
      longShortRatio: parseFloat(data[0].longShortRatio),
    };
  } catch {
    logger.warn('No se pudo obtener Long/Short Ratio');
    return null;
  }
}

export async function fetchTopTraderLongShortRatio(): Promise<LongShortRatio | null> {
  try {
    const data = await fetchBinanceFapi(
      '/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1'
    ) as { longAccount: string; shortAccount: string; longShortRatio: string }[] | null;

    if (!data || !data[0]) return null;
    return {
      longAccount: parseFloat(data[0].longAccount),
      shortAccount: parseFloat(data[0].shortAccount),
      longShortRatio: parseFloat(data[0].longShortRatio),
    };
  } catch {
    logger.warn('No se pudo obtener Top Trader Long/Short Ratio');
    return null;
  }
}

export async function fetchTopTraderPositionRatio(): Promise<LongShortRatio | null> {
  try {
    const data = await fetchBinanceFapi(
      '/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1'
    ) as { longAccount: string; shortAccount: string; longShortRatio: string }[] | null;

    if (!data || !data[0]) return null;
    return {
      longAccount: parseFloat(data[0].longAccount),
      shortAccount: parseFloat(data[0].shortAccount),
      longShortRatio: parseFloat(data[0].longShortRatio),
    };
  } catch {
    logger.warn('No se pudo obtener Top Trader Position Ratio');
    return null;
  }
}

// ─── Taker Buy/Sell Volume ───

export async function fetchTakerVolume(): Promise<TakerVolume | null> {
  try {
    const data = await fetchBinanceFapi(
      '/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1'
    ) as { buyVol: string; sellVol: string; buySellRatio: string }[] | null;

    if (!data || !data[0]) return null;
    return {
      buyVolume: parseFloat(data[0].buyVol),
      sellVolume: parseFloat(data[0].sellVol),
      buySellRatio: parseFloat(data[0].buySellRatio),
    };
  } catch {
    logger.warn('No se pudo obtener Taker Volume');
    return null;
  }
}

// ─── Mark Price / Index Price / Premium ───

export async function fetchMarkPremium(): Promise<MarkPremium> {
  const exchange = getExchange();
  try {
    const data = await exchange.fetchFundingRate(SYMBOL);
    const raw = data as unknown as Record<string, unknown>;
    const markPrice = (raw.markPrice as number) ?? 0;
    const indexPrice = (raw.indexPrice as number) ?? 0;
    const estimatedSettlePrice = (raw.estimatedSettlePrice as number) ?? 0;
    const premium = markPrice - indexPrice;
    const premiumPct = indexPrice > 0 ? (premium / indexPrice) * 100 : 0;

    return {
      markPrice,
      indexPrice,
      estimatedSettlePrice,
      lastFundingRate: data.fundingRate ?? 0,
      nextFundingTime: data.fundingDatetime ? new Date(data.fundingDatetime).getTime() : 0,
      interestRate: (raw.interestRate as number) ?? 0,
      premium: Math.round(premium * 100) / 100,
      premiumPct: Math.round(premiumPct * 10000) / 10000,
    };
  } catch {
    logger.warn('No se pudo obtener Mark/Premium data');
    return {
      markPrice: 0, indexPrice: 0, estimatedSettlePrice: 0,
      lastFundingRate: 0, nextFundingTime: 0, interestRate: 0,
      premium: 0, premiumPct: 0,
    };
  }
}

// ─── Recent Liquidations ───

export function fetchRecentLiquidations(): { side: string; price: number; quantity: number; time: number }[] {
  return getRecentLiquidations();
}

// ─── Ticker 24h ───

export async function fetchTicker24h(): Promise<Ticker24h> {
  const exchange = getExchange();
  try {
    const ticker = await exchange.fetchTicker(SYMBOL);
    return {
      high: ticker.high ?? 0,
      low: ticker.low ?? 0,
      volume: ticker.baseVolume ?? 0,
      quoteVolume: ticker.quoteVolume ?? 0,
      changePct: ticker.percentage ?? 0,
      prevClose: ticker.previousClose ?? 0,
    };
  } catch {
    logger.warn('No se pudo obtener Ticker 24h');
    return { high: 0, low: 0, volume: 0, quoteVolume: 0, changePct: 0, prevClose: 0 };
  }
}

// ─── Price Performance (7d, 30d, 90d, 180d, 1y) ───

export async function fetchPricePerformance(): Promise<PricePerformance> {
  const exchange = getExchange();
  try {
    // Fetch daily candles (365 days) to calculate performance
    const raw = await exchange.fetchOHLCV(SYMBOL, '1d', undefined, 365);
    const closes = raw.map((c) => c[4] as number);
    const currentPrice = closes.at(-1) ?? 0;

    const calcChange = (daysAgo: number): number => {
      const idx = closes.length - 1 - daysAgo;
      if (idx < 0 || !closes[idx]) return 0;
      return ((currentPrice - closes[idx]!) / closes[idx]!) * 100;
    };

    return {
      change7d: Math.round(calcChange(7) * 100) / 100,
      change30d: Math.round(calcChange(30) * 100) / 100,
      change90d: Math.round(calcChange(90) * 100) / 100,
      change180d: Math.round(calcChange(180) * 100) / 100,
      change1y: Math.round(calcChange(365) * 100) / 100,
    };
  } catch {
    logger.warn('No se pudo calcular Price Performance');
    return { change7d: 0, change30d: 0, change90d: 0, change180d: 0, change1y: 0 };
  }
}

// ─── Fetch All Market Data ───

export async function fetchAllMarketData(): Promise<MarketDataPackage> {
  logger.info('Fetching market data avanzada...');

  const [orderBook, openInterest, longShortRatio, topTraderLSR, topTraderPos, takerVol, markPremium, liquidations, ticker24h, performance] =
    await Promise.all([
      fetchOrderBook(20),
      fetchOpenInterest(),
      fetchLongShortRatio(),
      fetchTopTraderLongShortRatio(),
      fetchTopTraderPositionRatio(),
      fetchTakerVolume(),
      fetchMarkPremium(),
      fetchRecentLiquidations(),
      fetchTicker24h(),
      fetchPricePerformance(),
    ]);

  logger.info(
    {
      oi: openInterest.openInterest,
      lsRatio: longShortRatio?.longShortRatio,
      takerBSRatio: takerVol?.buySellRatio,
      premium: markPremium.premiumPct,
      liquidations: liquidations.length,
    },
    'Market data obtenida',
  );

  return {
    orderBook,
    openInterest,
    longShortRatio,
    topTraderLongShortRatio: topTraderLSR,
    topTraderPositionRatio: topTraderPos,
    takerVolume: takerVol,
    markPremium,
    recentLiquidations: liquidations,
    ticker24h,
    performance,
  };
}
