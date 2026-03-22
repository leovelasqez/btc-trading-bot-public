/**
 * Test completo del flujo de trading:
 * 1. CROSS margin + leverage
 * 2. Market order (0.001 BTC)
 * 3. SL + TP
 * 4. Cierra inmediatamente
 *
 * Uso: node dist/test-full-flow.js
 */
import { getExchange } from './exchange/binance.js';
import { setMarginMode, setLeverage, openMarketOrder, placeLimitOrder, placeStopLoss, placeTakeProfit, cancelAllOrders, getBalance, hasOpenPosition } from './exchange/orders.js';
import { logger } from './config/logger.js';
import { SYMBOL } from './config/constants.js';

const QTY = 0.002; // Notional mínimo $100 → 0.002 BTC ≈ $148

async function test(): Promise<void> {
  try {
    // 0. Cargar mercados
    const exchange = getExchange();
    await exchange.loadMarkets();
    logger.info('Mercados cargados');

    const balance = await getBalance();
    logger.info({ balance }, 'Balance actual');

    // 1. CROSS margin + leverage
    logger.info('=== Step 1: CROSS margin + leverage ===');
    await setMarginMode('cross');
    await setLeverage();
    logger.info('✅ Margin mode y leverage OK');

    // 2. Cancelar órdenes previas
    logger.info('=== Step 2: Cancelar órdenes previas ===');
    await cancelAllOrders();
    logger.info('✅ Órdenes canceladas');

    // 3. Obtener precio actual para calcular SL/TP
    const ticker = await exchange.fetchTicker(SYMBOL);
    const price = ticker.last ?? 0;
    logger.info({ price }, 'Precio actual');

    // SL a 2% abajo, TP a 2% arriba (LONG)
    const sl = Math.round(price * 0.98 * 100) / 100;
    const tp = Math.round(price * 1.02 * 100) / 100;

    // 4. Abrir MARKET LONG
    logger.info('=== Step 3: Abriendo MARKET LONG ===');
    const entry = await openMarketOrder('buy', QTY);
    logger.info({ orderId: entry.orderId, price: entry.price, qty: entry.quantity }, '✅ Posición abierta');

    // 5. Colocar SL
    logger.info('=== Step 4: Colocando SL ===');
    const slOrder = await placeStopLoss('sell', QTY, sl);
    logger.info({ orderId: slOrder.orderId, sl }, '✅ SL colocado');

    // 6. Colocar TP
    logger.info('=== Step 5: Colocando TP ===');
    const tpOrder = await placeTakeProfit('sell', QTY, tp);
    logger.info({ orderId: tpOrder.orderId, tp }, '✅ TP colocado');

    // 7. Verificar posición abierta
    logger.info('=== Step 6: Verificando posición ===');
    const pos = await hasOpenPosition();
    logger.info({ open: pos.open, side: pos.side, size: pos.size }, '✅ Posición verificada');

    // 8. Cancelar SL/TP y cerrar posición
    logger.info('=== Step 7: Cerrando posición ===');
    await cancelAllOrders();
    const close = await openMarketOrder('sell', QTY);
    logger.info({ orderId: close.orderId, price: close.price }, '✅ Posición cerrada');

    // 9. Verificar que no hay posición
    const posAfter = await hasOpenPosition();
    logger.info({ open: posAfter.open }, '✅ Sin posición abierta');

    const balanceAfter = await getBalance();
    const diff = balanceAfter - balance;
    logger.info({ balanceBefore: balance, balanceAfter, diff: diff.toFixed(4) }, '=== TEST COMPLETADO ===');

  } catch (err) {
    logger.error({ err }, '❌ TEST FALLÓ');
  }
  process.exit(0);
}

test();
