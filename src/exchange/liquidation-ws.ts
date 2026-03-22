/**
 * WebSocket collector for Binance Futures liquidation events.
 * Replaces the deprecated REST endpoint /fapi/v1/allForceOrders.
 * Buffers events in memory and exposes them via getRecentLiquidations().
 */
import WebSocket from 'ws';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// ─── Types ───

interface LiquidationEvent {
  side: string;
  price: number;
  quantity: number;
  time: number;
}

interface BinanceForceOrderMsg {
  e: 'forceOrder';
  E: number;
  o: {
    s: string;
    S: string;   // "BUY" | "SELL"
    o: string;
    f: string;
    q: string;   // quantity
    p: string;   // price
    ap: string;
    X: string;   // "FILLED" | "NEW" | etc
    l: string;
    z: string;
    T: number;   // trade time
  };
}

// ─── Config ───

const MAX_BUFFER_AGE_MS = 60 * 60 * 1000; // 1 hour
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

// ─── State ───

let buffer: LiquidationEvent[] = [];
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;

// ─── Internal ───

function getWsUrl(): string {
  const isTestnet = env.BINANCE_TESTNET === 'true';
  return isTestnet
    ? 'wss://fstream.binancefuture.com/ws/btcusdt@forceOrder'
    : 'wss://fstream.binance.com/ws/btcusdt@forceOrder';
}

function pruneBuffer(): void {
  const cutoff = Date.now() - MAX_BUFFER_AGE_MS;
  // Events arrive chronologically, so find first non-expired
  let i = 0;
  while (i < buffer.length && buffer[i]!.time < cutoff) i++;
  if (i > 0) buffer.splice(0, i);
}

function connect(): void {
  if (isShuttingDown) return;

  const url = getWsUrl();
  logger.info({ url }, 'Conectando WebSocket de liquidaciones...');

  ws = new WebSocket(url);

  ws.on('open', () => {
    reconnectAttempts = 0;
    logger.info('WebSocket de liquidaciones conectado');
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as BinanceForceOrderMsg;
      if (msg.e !== 'forceOrder') return;

      // Only buffer filled orders
      if (msg.o.X !== 'FILLED') return;

      buffer.push({
        side: msg.o.S,
        price: parseFloat(msg.o.p),
        quantity: parseFloat(msg.o.q),
        time: msg.o.T,
      });

      pruneBuffer();
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    ws = null;
    if (!isShuttingDown) {
      logger.warn('WebSocket de liquidaciones desconectado, reconectando...');
      scheduleReconnect();
    }
  });

  ws.on('error', (err: Error) => {
    logger.warn({ err: err.message }, 'Error en WebSocket de liquidaciones');
    // onclose will fire after this, triggering reconnect
  });
}

function scheduleReconnect(): void {
  if (isShuttingDown) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts++;

  logger.info({ delay, attempt: reconnectAttempts }, 'Reintento de WebSocket de liquidaciones');
  reconnectTimer = setTimeout(connect, delay);
}

// ─── Public API ───

export function startLiquidationCollector(): void {
  isShuttingDown = false;
  buffer = [];
  connect();
}

export function stopLiquidationCollector(): void {
  isShuttingDown = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

export function getRecentLiquidations(): LiquidationEvent[] {
  pruneBuffer();
  return [...buffer];
}
