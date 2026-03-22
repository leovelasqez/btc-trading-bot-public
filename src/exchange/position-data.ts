/**
 * Position Data — extrae datos detallados de la posición abierta en Binance
 * Incluye cálculo de costos (comisiones + funding fees) y breakeven neto
 */
import { getExchange } from './binance.js';
import { SYMBOL } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export interface PositionData {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  notional: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  markPrice: number;
  marginUsed: number;
}

export interface TradeCosts {
  entryCommission: number;
  estimatedExitCommission: number;
  accumulatedFunding: number;
  totalCosts: number;
  netBreakeven: number;
}

const TAKER_FEE_RATE = 0.0004; // 0.04% Binance Futures taker fee

/**
 * Obtiene datos completos de la posición abierta
 */
export async function fetchPositionData(): Promise<PositionData | null> {
  const exchange = getExchange();

  try {
    const positions = await exchange.fetchPositions([SYMBOL]);

    for (const pos of positions) {
      const contracts = Math.abs(pos.contracts ?? 0);
      if (contracts <= 0) continue;

      const side: 'LONG' | 'SHORT' = pos.side === 'short' ? 'SHORT' : 'LONG';

      const data: PositionData = {
        side,
        entryPrice: Number(pos.entryPrice ?? 0),
        quantity: contracts,
        notional: Math.abs(Number(pos.notional ?? 0)),
        unrealizedPnl: Number(pos.unrealizedPnl ?? 0),
        leverage: Number(pos.leverage) || env.LEVERAGE,
        liquidationPrice: Number(pos.liquidationPrice ?? 0),
        markPrice: Number(pos.markPrice ?? 0),
        marginUsed: Number(pos.initialMargin ?? pos.collateral ?? 0),
      };

      logger.info(
        {
          side: data.side,
          entry: data.entryPrice,
          qty: data.quantity,
          pnl: data.unrealizedPnl,
          mark: data.markPrice,
        },
        'Datos de posición obtenidos',
      );

      return data;
    }

    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ error: msg }, 'Error obteniendo datos de posición');
    return null;
  }
}

/**
 * Calcula los costos reales del trade (comisiones + funding fees)
 * y el breakeven neto
 */
export async function fetchTradeCosts(position: PositionData): Promise<TradeCosts> {
  const exchange = getExchange();

  // 1. Comisión de entrada: buscar en trades recientes
  let entryCommission = 0;
  try {
    const trades = await exchange.fetchMyTrades(SYMBOL, undefined, 20);
    // Buscar trades cuyo precio coincida con el entry price (con margen de tolerancia)
    const entryTrades = trades.filter((t) => {
      const priceDiff = Math.abs(Number(t.price) - position.entryPrice);
      return priceDiff / position.entryPrice < 0.001; // 0.1% tolerancia
    });

    if (entryTrades.length > 0) {
      entryCommission = entryTrades.reduce(
        (sum, t) => sum + Number(t.fee?.cost ?? 0),
        0,
      );
    } else {
      // Fallback: estimar con fee rate
      entryCommission = position.notional * TAKER_FEE_RATE;
    }
  } catch {
    entryCommission = position.notional * TAKER_FEE_RATE;
    logger.warn('No se pudieron obtener trades recientes, estimando comisión de entrada');
  }

  // 2. Comisión estimada de salida (al precio actual)
  const currentNotional = position.markPrice * position.quantity;
  const estimatedExitCommission = currentNotional * TAKER_FEE_RATE;

  // 3. Funding fees acumulados
  let accumulatedFunding = 0;
  try {
    const rawSymbol = SYMBOL.replace('/', '').replace(':USDT', '');
    const incomeData = await exchange.fetchFundingHistory(rawSymbol, undefined, 100);
    accumulatedFunding = Math.abs(
      incomeData.reduce((sum: number, entry) => {
        return sum + Number(entry.amount ?? 0);
      }, 0),
    );
  } catch {
    // Fallback: estimar basado en funding rate actual y tiempo abierto
    try {
      const ticker = await exchange.fetchTicker(SYMBOL);
      const fundingRate = Number(ticker.info?.lastFundingRate ?? 0);
      // Estimar 1 periodo de funding (8h)
      accumulatedFunding = Math.abs(position.notional * fundingRate);
    } catch {
      accumulatedFunding = 0;
    }
    logger.warn('No se pudo obtener historial de funding, usando estimación');
  }

  // 4. Costos totales
  const totalCosts = entryCommission + estimatedExitCommission + accumulatedFunding;

  // 5. Breakeven neto
  const costPerUnit = totalCosts / position.quantity;
  const netBreakeven =
    position.side === 'LONG'
      ? position.entryPrice + costPerUnit
      : position.entryPrice - costPerUnit;

  const costs: TradeCosts = {
    entryCommission: Math.round(entryCommission * 100) / 100,
    estimatedExitCommission: Math.round(estimatedExitCommission * 100) / 100,
    accumulatedFunding: Math.round(accumulatedFunding * 100) / 100,
    totalCosts: Math.round(totalCosts * 100) / 100,
    netBreakeven: Math.round(netBreakeven * 100) / 100,
  };

  logger.info(
    {
      entryComm: costs.entryCommission,
      exitComm: costs.estimatedExitCommission,
      funding: costs.accumulatedFunding,
      total: costs.totalCosts,
      breakeven: costs.netBreakeven,
    },
    'Costos del trade calculados',
  );

  return costs;
}
