/**
 * Creación y gestión de órdenes en Binance Futures
 */
import { getExchange } from './binance.js';
import { SYMBOL } from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface OrderResult {
  orderId: string;
  price: number;
  quantity: number;
  side: string;
  status: string;
}

/**
 * Configura el modo de margen (ISOLATED o CROSS según confidence)
 */
export async function setMarginMode(mode: 'isolated' | 'cross' = 'isolated'): Promise<void> {
  const exchange = getExchange();
  try {
    await exchange.setMarginMode(mode, SYMBOL);
    logger.info({ mode, symbol: SYMBOL }, 'Margin mode configurado');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('No need to change margin type') || msg.includes('already')) {
      logger.info({ mode }, `Margin mode ya es ${mode.toUpperCase()}`);
    } else {
      throw err;
    }
  }
}

/**
 * Configura el apalancamiento para el símbolo
 */
export async function setLeverage(): Promise<void> {
  const exchange = getExchange();
  try {
    await exchange.setLeverage(env.LEVERAGE, SYMBOL);
    logger.info({ leverage: env.LEVERAGE, symbol: SYMBOL }, 'Leverage configurado');
  } catch (err: unknown) {
    // Binance puede dar error si ya está seteado al mismo valor
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('No need to change leverage')) {
      logger.info({ leverage: env.LEVERAGE }, 'Leverage ya configurado');
    } else {
      throw err;
    }
  }
}

/**
 * Abre posición con orden market
 */
export async function openMarketOrder(
  side: 'buy' | 'sell',
  quantity: number,
): Promise<OrderResult> {
  const exchange = getExchange();

  logger.info({ side, quantity, symbol: SYMBOL }, 'Abriendo orden market');
  const order = await exchange.createMarketOrder(SYMBOL, side, quantity);

  const result: OrderResult = {
    orderId: order.id,
    price: order.average ?? order.price ?? 0,
    quantity: order.filled ?? order.amount,
    side: order.side ?? side,
    status: order.status ?? 'unknown',
  };

  logger.info(result, 'Orden market ejecutada');
  return result;
}

/**
 * Coloca orden limit GTC (Good Till Cancelled)
 */
export async function placeLimitOrder(
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
): Promise<OrderResult> {
  const exchange = getExchange();

  logger.info({ side, quantity, price, symbol: SYMBOL }, 'Colocando orden limit');
  const order = await exchange.createLimitOrder(SYMBOL, side, quantity, price);

  const result: OrderResult = {
    orderId: order.id,
    price: order.price ?? price,
    quantity: order.amount ?? quantity,
    side: order.side ?? side,
    status: order.status ?? 'new',
  };

  logger.info(result, 'Orden limit colocada');
  return result;
}

/**
 * Coloca Stop Loss como orden stop market
 */
export async function placeStopLoss(
  side: 'buy' | 'sell', // Lado opuesto a la posición
  quantity: number,
  stopPrice: number,
): Promise<OrderResult> {
  const exchange = getExchange();

  logger.info({ side, quantity, stopPrice }, 'Colocando Stop Loss');
  const order = await exchange.createOrder(
    SYMBOL,
    'STOP_MARKET',
    side,
    quantity,
    undefined,
    {
      stopPrice,
      reduceOnly: true,
      workingType: 'MARK_PRICE',
    },
  );

  const result: OrderResult = {
    orderId: order.id,
    price: stopPrice,
    quantity,
    side,
    status: order.status ?? 'new',
  };

  logger.info(result, 'Stop Loss colocado');
  return result;
}

/**
 * Coloca Take Profit como orden take profit market
 */
export async function placeTakeProfit(
  side: 'buy' | 'sell', // Lado opuesto a la posición
  quantity: number,
  takeProfitPrice: number,
): Promise<OrderResult> {
  const exchange = getExchange();

  logger.info({ side, quantity, takeProfitPrice }, 'Colocando Take Profit');
  const order = await exchange.createOrder(
    SYMBOL,
    'TAKE_PROFIT_MARKET',
    side,
    quantity,
    undefined,
    {
      stopPrice: takeProfitPrice,
      reduceOnly: true,
      workingType: 'MARK_PRICE',
    },
  );

  const result: OrderResult = {
    orderId: order.id,
    price: takeProfitPrice,
    quantity,
    side,
    status: order.status ?? 'new',
  };

  logger.info(result, 'Take Profit colocado');
  return result;
}

/**
 * Obtiene el balance disponible en USDT
 */
export async function getBalance(): Promise<number> {
  const exchange = getExchange();
  const balance = await exchange.fetchBalance();
  const usdt = (balance as unknown as Record<string, Record<string, number>>).free?.['USDT'] ?? (balance as unknown as Record<string, Record<string, number>>).total?.['USDT'] ?? 0;
  logger.info({ usdt }, 'Balance USDT');
  return Number(usdt);
}

/**
 * Verifica si hay una posición abierta en el símbolo
 */
export async function hasOpenPosition(): Promise<{ open: boolean; side?: 'LONG' | 'SHORT'; size?: number }> {
  const exchange = getExchange();
  try {
    const positions = await exchange.fetchPositions([SYMBOL]);
    for (const pos of positions) {
      const contracts = Math.abs(pos.contracts ?? 0);
      if (contracts > 0) {
        const side: 'LONG' | 'SHORT' = pos.side === 'short' ? 'SHORT' : 'LONG';
        logger.info({ side, contracts, symbol: SYMBOL }, 'Posición abierta detectada');
        return { open: true, side, size: contracts };
      }
    }
    return { open: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ error: msg }, 'No se pudo verificar posiciones abiertas');
    return { open: false };
  }
}

/**
 * Info de una orden abierta (SL o TP)
 */
export interface OpenOrderInfo {
  orderId: string;
  type: string; // 'STOP_MARKET' | 'TAKE_PROFIT_MARKET' | etc.
  side: string;
  stopPrice: number;
  quantity: number;
}

/**
 * Obtiene las órdenes abiertas del símbolo (SL, TP, etc.)
 * Incluye tanto órdenes regulares como algo/conditional orders (STOP_MARKET, TAKE_PROFIT_MARKET)
 */
export async function getOpenOrders(): Promise<OpenOrderInfo[]> {
  const exchange = getExchange();
  const results: OpenOrderInfo[] = [];

  // 1. Órdenes regulares (LIMIT, MARKET)
  try {
    const orders = await exchange.fetchOpenOrders(SYMBOL);
    for (const o of orders) {
      results.push({
        orderId: o.id,
        type: String(o.type ?? '').toUpperCase(),
        side: o.side ?? '',
        stopPrice: Number(o.stopPrice ?? o.triggerPrice ?? o.price ?? 0),
        quantity: Number(o.amount ?? 0),
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ error: msg }, 'Error obteniendo órdenes regulares');
  }

  // 2. Algo/conditional orders (STOP_MARKET, TAKE_PROFIT_MARKET)
  try {
    const algoOrders = await (exchange as any).fapiPrivateGetOpenAlgoOrders({ symbol: SYMBOL.replace('/', '').replace(':USDT', '') });
    for (const o of algoOrders) {
      results.push({
        orderId: String(o.algoId),
        type: String(o.orderType ?? '').toUpperCase(),
        side: String(o.side ?? '').toLowerCase(),
        stopPrice: Number(o.triggerPrice ?? 0),
        quantity: Number(o.quantity ?? 0),
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ error: msg }, 'Error obteniendo algo/conditional orders');
  }

  return results;
}

/**
 * Obtiene solo las órdenes limit pendientes del símbolo
 */
export async function getPendingLimitOrders(): Promise<OpenOrderInfo[]> {
  const orders = await getOpenOrders();
  return orders.filter((o) => o.type === 'LIMIT');
}

/**
 * Cierra una posición abierta con orden market
 */
export async function closePosition(
  side: 'LONG' | 'SHORT',
  quantity: number,
): Promise<OrderResult> {
  const closeSide = side === 'LONG' ? 'sell' : 'buy';
  logger.info({ side, closeSide, quantity }, 'Cerrando posición');
  return openMarketOrder(closeSide, quantity);
}

/**
 * Cancela una orden específica por ID
 * Detecta automáticamente si es una algo/conditional order (ID 4000000...) o regular
 */
export async function cancelOrder(orderId: string): Promise<void> {
  const exchange = getExchange();
  const isAlgoOrder = orderId.startsWith('4000000');

  try {
    if (isAlgoOrder) {
      await (exchange as any).fapiPrivateDeleteAlgoOrder({ algoId: orderId });
      logger.info({ orderId, type: 'algo' }, 'Algo order cancelada');
    } else {
      await exchange.cancelOrder(orderId, SYMBOL);
      logger.info({ orderId }, 'Orden cancelada');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unknown order') || msg.includes('UNKNOWN_ORDER') || msg.includes('does not exist')) {
      logger.info({ orderId }, 'Orden ya no existe (posiblemente ejecutada)');
    } else {
      throw err;
    }
  }
}

/**
 * Cancela todas las órdenes abiertas del símbolo
 * Cancela tanto órdenes regulares como algo/conditional orders
 */
export async function cancelAllOrders(): Promise<void> {
  const exchange = getExchange();
  const rawSymbol = SYMBOL.replace('/', '').replace(':USDT', '');

  // 1. Cancelar órdenes regulares
  try {
    await exchange.cancelAllOrders(SYMBOL);
    logger.info({ symbol: SYMBOL }, 'Órdenes regulares canceladas');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('No open orders')) {
      logger.warn({ error: msg }, 'Error cancelando órdenes regulares');
    }
  }

  // 2. Cancelar algo/conditional orders (STOP_MARKET, TAKE_PROFIT_MARKET)
  try {
    await (exchange as any).fapiPrivateDeleteAlgoOpenOrders({ symbol: rawSymbol });
    logger.info({ symbol: rawSymbol }, 'Algo/conditional orders canceladas');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('No open orders') && !msg.includes('no algo open order')) {
      logger.warn({ error: msg }, 'Error cancelando algo/conditional orders');
    }
  }
}
