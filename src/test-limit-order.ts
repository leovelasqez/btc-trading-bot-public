/**
 * Test 1: Limit order placement + cancellation
 * Places a limit order far from market price, verifies it exists, then cancels.
 * Cost: $0 (order never fills)
 *
 * Uso: node dist/test-limit-order.js
 */
import { getExchange } from './exchange/binance.js';
import { setMarginMode, setLeverage, placeLimitOrder, getPendingLimitOrders, cancelAllOrders, getBalance } from './exchange/orders.js';
import { logger } from './config/logger.js';
import { SYMBOL } from './config/constants.js';

async function test(): Promise<void> {
  try {
    // 0. Setup
    const exchange = getExchange();
    await exchange.loadMarkets();
    logger.info('Mercados cargados');

    const balance = await getBalance();
    logger.info({ balance }, 'Balance actual');

    // 1. CROSS margin + leverage
    logger.info('=== Step 1: CROSS margin + leverage ===');
    await setMarginMode('cross');
    await setLeverage();
    logger.info('✅ OK');

    // 2. Obtener precio actual
    const ticker = await exchange.fetchTicker(SYMBOL);
    const price = ticker.last ?? 0;
    logger.info({ price }, 'Precio actual');

    // 3. Colocar limit order un 5% por debajo del precio (nunca se llenará)
    const limitPrice = Math.round(price * 0.95 * 100) / 100;
    logger.info('=== Step 2: Colocando limit order BUY ===');
    const order = await placeLimitOrder('buy', 0.002, limitPrice);
    logger.info({ orderId: order.orderId, limitPrice: order.price, status: order.status }, '✅ Limit order colocada');

    // 4. Verificar que aparece en órdenes pendientes
    logger.info('=== Step 3: Verificando órdenes pendientes ===');
    const pending = await getPendingLimitOrders();
    const found = pending.find((o) => o.orderId === order.orderId);
    if (found) {
      logger.info({ orderId: found.orderId, type: found.type, price: found.stopPrice }, '✅ Limit order encontrada en pendientes');
    } else {
      logger.error({ pendingCount: pending.length, pending }, '❌ Limit order NO encontrada en pendientes');
    }

    // 5. Cancelar la orden
    logger.info('=== Step 4: Cancelando limit order ===');
    await cancelAllOrders();
    logger.info('✅ Órdenes canceladas');

    // 6. Verificar que ya no hay pendientes
    const pendingAfter = await getPendingLimitOrders();
    if (pendingAfter.length === 0) {
      logger.info('✅ Sin órdenes pendientes');
    } else {
      logger.error({ count: pendingAfter.length }, '❌ Todavía hay órdenes pendientes');
    }

    // 7. Verificar balance no cambió
    const balanceAfter = await getBalance();
    const diff = balanceAfter - balance;
    logger.info({ balanceBefore: balance, balanceAfter, diff: diff.toFixed(4) }, '=== TEST COMPLETADO (diff debe ser ~0) ===');

  } catch (err) {
    logger.error({ err }, '❌ TEST FALLÓ');
  }
  process.exit(0);
}

test();
