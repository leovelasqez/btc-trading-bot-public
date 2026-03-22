/**
 * Test 3: Position sizer — verifica que siempre usa 100% del balance
 * No abre órdenes reales, solo calcula y verifica.
 * Cost: $0
 *
 * Uso: node dist/test-position-sizer.js
 */
import { getExchange } from './exchange/binance.js';
import { getBalance } from './exchange/orders.js';
import { calculatePositionSize } from './risk/position-sizer.js';
import { logger } from './config/logger.js';
import { SYMBOL } from './config/constants.js';

async function test(): Promise<void> {
  try {
    // 0. Setup — get real balance and price
    const exchange = getExchange();
    await exchange.loadMarkets();

    const balance = await getBalance();
    const ticker = await exchange.fetchTicker(SYMBOL);
    const price = ticker.last ?? 0;

    logger.info({ balance, price }, 'Datos reales del mercado');

    const expectedMargin = balance * 1.0;

    // Test A: Confidence 70% → 100% balance
    logger.info('=== Test A: Confidence 70% (100% balance) ===');
    const slA = Math.round(price * 0.98 * 100) / 100;
    const sizeA = calculatePositionSize(balance, price, slA, 70);
    const marginOkA = Math.abs(sizeA.marginUsdt - expectedMargin) < 1;
    logger.info({
      confidence: 70,
      expectedMargin: expectedMargin.toFixed(2),
      actualMargin: sizeA.marginUsdt,
      positionSize: sizeA.positionSizeUsdt,
      quantity: sizeA.quantity,
      riskUsdt: sizeA.riskUsdt,
      riskPct: sizeA.riskPct,
      marginCorrect: marginOkA,
    }, marginOkA ? '✅ 100% balance correcto' : '❌ Margin incorrecto');

    // Test B: Confidence 85% → 100% balance
    logger.info('=== Test B: Confidence 85% (100% balance) ===');
    const slB = Math.round(price * 0.98 * 100) / 100;
    const sizeB = calculatePositionSize(balance, price, slB, 85);
    const marginOkB = Math.abs(sizeB.marginUsdt - expectedMargin) < 1;
    logger.info({
      confidence: 85,
      expectedMargin: expectedMargin.toFixed(2),
      actualMargin: sizeB.marginUsdt,
      positionSize: sizeB.positionSizeUsdt,
      quantity: sizeB.quantity,
      riskUsdt: sizeB.riskUsdt,
      riskPct: sizeB.riskPct,
      marginCorrect: marginOkB,
    }, marginOkB ? '✅ 100% balance correcto' : '❌ Margin incorrecto');

    // Test C: Confidence 75% → 100% balance (antes era 50%, ahora siempre 100%)
    logger.info('=== Test C: Confidence 75% (100% balance, ya no 50%) ===');
    const slC = Math.round(price * 0.98 * 100) / 100;
    const sizeC = calculatePositionSize(balance, price, slC, 75);
    const marginOkC = Math.abs(sizeC.marginUsdt - expectedMargin) < 1;
    logger.info({
      confidence: 75,
      expectedMargin: expectedMargin.toFixed(2),
      actualMargin: sizeC.marginUsdt,
      quantity: sizeC.quantity,
      marginCorrect: marginOkC,
    }, marginOkC ? '✅ 100% balance correcto (antes era 50%)' : '❌ Margin incorrecto');

    // Test D: Todos deben dar el mismo margin y quantity
    logger.info('=== Test D: Mismo tamaño para todos los confidence levels ===');
    const sameSize = sizeA.quantity === sizeB.quantity && sizeB.quantity === sizeC.quantity;
    logger.info({
      qty70: sizeA.quantity,
      qty85: sizeB.quantity,
      qty75: sizeC.quantity,
      allEqual: sameSize,
    }, sameSize ? '✅ Todos usan el mismo tamaño' : '❌ Tamaños diferentes');

    // Test E: Notional mínimo $100
    logger.info('=== Test E: Notional mínimo $100 ===');
    const notional = sizeA.quantity * price;
    logger.info({
      notional: notional.toFixed(2),
      meetsMin: notional >= 100,
    }, notional >= 100 ? '✅ Cumple notional mínimo' : '⚠️ No cumple notional mínimo');

    // Summary
    const allPassed = marginOkA && marginOkB && marginOkC && sameSize;
    logger.info({ allPassed }, allPassed ? '=== TODOS LOS TESTS PASARON ===' : '=== ALGUNOS TESTS FALLARON ===');

  } catch (err) {
    logger.error({ err }, '❌ TEST FALLÓ');
  }
  process.exit(0);
}

test();
