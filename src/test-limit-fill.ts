/**
 * Test 2: Limit order fill detection via WebSocket + automatic SL/TP
 * Places a limit order at current ask price (fills immediately),
 * waits for WebSocket to detect fill and place SL/TP, then cleans up.
 * Cost: ~$0.15 in commissions
 *
 * Uso: pm2 stop btc-bot && node dist/test-limit-fill.js
 */
import { getExchange } from './exchange/binance.js';
import { setMarginMode, setLeverage, placeLimitOrder, cancelAllOrders, getBalance, hasOpenPosition, openMarketOrder } from './exchange/orders.js';
import { startUserDataStream, stopUserDataStream, onOrderFill } from './exchange/user-data-ws.js';
import { logger } from './config/logger.js';
import { SYMBOL } from './config/constants.js';

const QTY = 0.002;

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
    await cancelAllOrders();
    logger.info('✅ OK');

    // 2. Start User Data WebSocket
    logger.info('=== Step 2: Iniciando User Data WebSocket ===');
    startUserDataStream();

    // Wait for WebSocket to connect
    await new Promise((resolve) => setTimeout(resolve, 5000));
    logger.info('✅ WebSocket iniciado (esperó 5s para conexión)');

    // 3. Register fill handler that places SL/TP
    logger.info('=== Step 3: Registrando fill handler ===');
    let fillDetected = false;
    let fillData: { avgPrice: number; filledQty: number; orderId: string } | null = null;

    onOrderFill(async (fill) => {
      logger.info({
        orderId: fill.orderId,
        side: fill.side,
        avgPrice: fill.avgPrice,
        filledQty: fill.filledQuantity,
        isFullyFilled: fill.isFullyFilled,
      }, '🔔 FILL DETECTADO POR WEBSOCKET');

      fillDetected = true;
      fillData = { avgPrice: fill.avgPrice, filledQty: fill.filledQuantity, orderId: fill.orderId };
    });
    logger.info('✅ Handler registrado');

    // 4. Get current price and place limit at ask (will fill immediately)
    const ticker = await exchange.fetchTicker(SYMBOL);
    const askPrice = ticker.ask ?? ticker.last ?? 0;
    // Place limit slightly above ask to ensure immediate fill
    const limitPrice = Math.round((askPrice + 10) * 100) / 100;
    logger.info({ askPrice, limitPrice }, 'Precio para limit order (debe llenarse inmediatamente)');

    logger.info('=== Step 4: Colocando limit BUY al precio ask (fill inmediato) ===');
    const order = await placeLimitOrder('buy', QTY, limitPrice);
    logger.info({ orderId: order.orderId, price: order.price, status: order.status }, '✅ Limit order colocada');

    // 5. Wait for fill detection (max 15 seconds)
    logger.info('=== Step 5: Esperando detección de fill (max 15s) ===');
    const startWait = Date.now();
    while (!fillDetected && Date.now() - startWait < 15000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (fillDetected && fillData !== null) {
      const fd = fillData as { avgPrice: number; filledQty: number; orderId: string };
      logger.info({
        avgPrice: fd.avgPrice,
        filledQty: fd.filledQty,
        orderId: fd.orderId,
      }, '✅ Fill detectado por WebSocket');
    } else {
      logger.error('❌ Fill NO detectado por WebSocket en 15 segundos');
    }

    // 6. Verify position exists
    logger.info('=== Step 6: Verificando posición ===');
    const pos = await hasOpenPosition();
    logger.info({ open: pos.open, side: pos.side, size: pos.size }, pos.open ? '✅ Posición abierta' : '❌ Sin posición');

    // 7. Clean up: cancel all orders and close position
    logger.info('=== Step 7: Limpieza ===');
    await cancelAllOrders();
    if (pos.open) {
      await openMarketOrder('sell', QTY);
      logger.info('✅ Posición cerrada');
    }

    // 8. Stop WebSocket
    stopUserDataStream();

    const balanceAfter = await getBalance();
    const diff = balanceAfter - balance;
    logger.info({
      balanceBefore: balance,
      balanceAfter,
      diff: diff.toFixed(4),
      fillDetected,
    }, '=== TEST COMPLETADO ===');

  } catch (err) {
    logger.error({ err }, '❌ TEST FALLÓ');
    // Cleanup on error
    try {
      await cancelAllOrders();
      const pos = await hasOpenPosition();
      if (pos.open) {
        await openMarketOrder('sell', QTY);
      }
      stopUserDataStream();
    } catch { /* ignore cleanup errors */ }
  }
  process.exit(0);
}

test();
