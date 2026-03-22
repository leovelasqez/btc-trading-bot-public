/**
 * WebSocket client for Binance Futures User Data Stream.
 * Detects when limit orders are filled and invokes registered callbacks.
 * Manages listenKey lifecycle (create, renew every 25 min, reconnect every 23h).
 */
import WebSocket from 'ws';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// ─── Types ───

export interface OrderFillEvent {
  symbol: string;
  orderId: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  orderStatus: string;
  price: number;
  quantity: number;
  filledQuantity: number;
  avgPrice: number;
  commission: number;
  commissionAsset: string;
  tradeTime: number;
  isFullyFilled: boolean;
}

export interface PositionCloseEvent {
  symbol: string;
  orderId: string;
  orderType: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  avgPrice: number;
  quantity: number;
  commission: number;
  commissionAsset: string;
  realizedProfit: number;
  tradeTime: number;
}

type OrderFillHandler = (fill: OrderFillEvent) => Promise<void>;
type PositionCloseHandler = (event: PositionCloseEvent) => Promise<void>;

interface BinanceOrderTradeUpdate {
  e: 'ORDER_TRADE_UPDATE';
  T: number;
  o: {
    s: string;      // Symbol
    c: string;      // Client Order ID
    S: string;      // Side: "BUY" | "SELL"
    o: string;      // Order Type: "LIMIT", "MARKET", etc.
    f: string;      // Time in Force
    q: string;      // Original Quantity
    p: string;      // Original Price
    ap: string;     // Average Price
    X: string;      // Order Status: "NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", etc.
    x: string;      // Execution Type: "NEW", "TRADE", "CANCELED", etc.
    i: number;      // Order ID
    l: string;      // Last Filled Quantity
    z: string;      // Cumulative Filled Quantity
    L: string;      // Last Filled Price
    n: string;      // Commission
    N: string;      // Commission Asset
    T: number;      // Trade Time
    t: number;      // Trade ID
    rp: string;     // Realized Profit
  };
}

// ─── Config ───

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const LISTEN_KEY_RENEW_MS = 25 * 60 * 1000;        // 25 minutes (margin before 60-min expiry)
const FORCE_RECONNECT_MS = 23 * 60 * 60 * 1000;    // 23 hours (Binance closes at 24h)

// ─── State ───

let ws: WebSocket | null = null;
let listenKey: string | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let renewTimer: ReturnType<typeof setInterval> | null = null;
let forceReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;
const handlers: OrderFillHandler[] = [];
const positionCloseHandlers: PositionCloseHandler[] = [];

// ─── ListenKey Management ───

function getFapiBaseUrl(): string {
  const isTestnet = env.BINANCE_TESTNET === 'true';
  return isTestnet
    ? 'https://testnet.binancefuture.com'
    : 'https://fapi.binance.com';
}

function getWsBaseUrl(): string {
  const isTestnet = env.BINANCE_TESTNET === 'true';
  return isTestnet
    ? 'wss://fstream.binancefuture.com/ws'
    : 'wss://fstream.binance.com/ws';
}

async function createListenKey(): Promise<string> {
  const url = `${getFapiBaseUrl()}/fapi/v1/listenKey`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': env.BINANCE_API_KEY },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create listenKey: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { listenKey: string };
  logger.info('ListenKey creado para User Data Stream');
  return data.listenKey;
}

async function renewListenKey(): Promise<void> {
  if (!listenKey) return;

  try {
    const url = `${getFapiBaseUrl()}/fapi/v1/listenKey`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'X-MBX-APIKEY': env.BINANCE_API_KEY },
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, 'Error renovando listenKey');
      return;
    }

    logger.debug('ListenKey renovado exitosamente');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, 'Error renovando listenKey');
  }
}

// ─── WebSocket Connection ───

function connect(): void {
  if (isShuttingDown || !listenKey) return;

  const url = `${getWsBaseUrl()}/${listenKey}`;
  logger.info({ url: url.replace(listenKey, '***') }, 'Conectando WebSocket de User Data Stream...');

  ws = new WebSocket(url);

  ws.on('open', () => {
    reconnectAttempts = 0;
    logger.info('WebSocket de User Data Stream conectado');
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as { e: string };

      // Only handle order trade updates
      if (msg.e !== 'ORDER_TRADE_UPDATE') return;

      const update = msg as BinanceOrderTradeUpdate;
      handleOrderUpdate(update);
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    ws = null;
    if (!isShuttingDown) {
      logger.warn('WebSocket de User Data Stream desconectado, reconectando...');
      scheduleReconnect();
    }
  });

  ws.on('error', (err: Error) => {
    logger.warn({ err: err.message }, 'Error en WebSocket de User Data Stream');
    // onclose will fire after this, triggering reconnect
  });
}

function handleOrderUpdate(update: BinanceOrderTradeUpdate): void {
  const o = update.o;

  // Only care about TRADE executions
  if (o.x !== 'TRADE') return;

  // LIMIT order fills (entry orders)
  if (o.o === 'LIMIT' && (o.X === 'FILLED' || o.X === 'PARTIALLY_FILLED')) {
    const fill: OrderFillEvent = {
      symbol: o.s,
      orderId: String(o.i),
      side: o.S as 'BUY' | 'SELL',
      orderType: o.o,
      orderStatus: o.X,
      price: parseFloat(o.p),
      quantity: parseFloat(o.q),
      filledQuantity: parseFloat(o.z),
      avgPrice: parseFloat(o.ap),
      commission: parseFloat(o.n),
      commissionAsset: o.N,
      tradeTime: o.T,
      isFullyFilled: o.X === 'FILLED',
    };

    logger.info(
      {
        symbol: fill.symbol,
        side: fill.side,
        orderId: fill.orderId,
        status: fill.orderStatus,
        avgPrice: fill.avgPrice,
        filledQty: fill.filledQuantity,
      },
      'Orden LIMIT ejecutada detectada',
    );

    for (const handler of handlers) {
      handler(fill).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'Error en handler de OrderFill');
      });
    }
  }

  // SL / TP fills (position close orders)
  if ((o.o === 'STOP_MARKET' || o.o === 'TAKE_PROFIT_MARKET') && o.X === 'FILLED') {
    const event: PositionCloseEvent = {
      symbol: o.s,
      orderId: String(o.i),
      orderType: o.o as 'STOP_MARKET' | 'TAKE_PROFIT_MARKET',
      avgPrice: parseFloat(o.ap),
      quantity: parseFloat(o.z),
      commission: parseFloat(o.n),
      commissionAsset: o.N,
      realizedProfit: parseFloat(o.rp),
      tradeTime: o.T,
    };

    logger.info(
      {
        symbol: event.symbol,
        orderType: event.orderType,
        avgPrice: event.avgPrice,
        qty: event.quantity,
        realizedProfit: event.realizedProfit,
      },
      'SL/TP ejecutado detectado',
    );

    for (const handler of positionCloseHandlers) {
      handler(event).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'Error en handler de PositionClose');
      });
    }
  }
}

function scheduleReconnect(): void {
  if (isShuttingDown) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts++;

  logger.info({ delay, attempt: reconnectAttempts }, 'Reintento de WebSocket de User Data Stream');
  reconnectTimer = setTimeout(() => {
    void startFresh();
  }, delay);
}

function clearAllTimers(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (renewTimer) {
    clearInterval(renewTimer);
    renewTimer = null;
  }
  if (forceReconnectTimer) {
    clearTimeout(forceReconnectTimer);
    forceReconnectTimer = null;
  }
}

function closeWebSocket(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
}

/**
 * Full restart: new listenKey + new WebSocket + new timers.
 */
async function startFresh(): Promise<void> {
  if (isShuttingDown) return;

  clearAllTimers();
  closeWebSocket();
  listenKey = null;

  try {
    listenKey = await createListenKey();

    // Connect WebSocket
    connect();

    // Schedule listenKey renewal every 25 min
    renewTimer = setInterval(() => {
      void renewListenKey();
    }, LISTEN_KEY_RENEW_MS);

    // Schedule forced reconnect in 23 hours (Binance closes at 24h)
    forceReconnectTimer = setTimeout(() => {
      logger.info('Reconexión forzada de User Data Stream (23h limit)');
      void startFresh();
    }, FORCE_RECONNECT_MS);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'Error iniciando User Data Stream');
    scheduleReconnect();
  }
}

// ─── Public API ───

export function startUserDataStream(): void {
  isShuttingDown = false;
  void startFresh();
}

export function stopUserDataStream(): void {
  isShuttingDown = true;
  clearAllTimers();
  closeWebSocket();
  listenKey = null;
  logger.info('User Data Stream detenido');
}

export function onOrderFill(handler: OrderFillHandler): void {
  handlers.push(handler);
}

export function onPositionClose(handler: PositionCloseHandler): void {
  positionCloseHandlers.push(handler);
}
