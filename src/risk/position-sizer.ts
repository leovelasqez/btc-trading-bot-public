/**
 * Cálculo de tamaño de posición basado en % del balance y apalancamiento
 */
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface PositionSize {
  /** Cantidad de BTC a operar */
  quantity: number;
  /** Tamaño de la posición en USDT (con leverage) */
  positionSizeUsdt: number;
  /** Margen requerido en USDT (sin leverage) */
  marginUsdt: number;
  /** Riesgo en USDT (distancia al SL * cantidad) */
  riskUsdt: number;
  /** Riesgo como % del balance */
  riskPct: number;
}

export function calculatePositionSize(
  balance: number,
  entryPrice: number,
  stopLossPrice: number,
  confidence?: number,
): PositionSize {
  const leverage = env.LEVERAGE;

  // Solo opera con confidence >= CONFIDENCE_THRESHOLD (validado antes de llegar aquí)
  // Siempre usa 100% de MAX_POSITION_PCT
  const balancePct = env.MAX_POSITION_PCT / 100;

  // Margen máximo = % del balance
  const maxMargin = balance * balancePct;

  // Tamaño de posición con leverage
  const positionSizeUsdt = maxMargin * leverage;

  // Cantidad de BTC
  const quantity = positionSizeUsdt / entryPrice;

  // Riesgo: distancia al stop loss * cantidad
  const slDistance = Math.abs(entryPrice - stopLossPrice);
  const riskUsdt = slDistance * quantity;
  const riskPct = (riskUsdt / balance) * 100;

  const result: PositionSize = {
    quantity: Math.floor(quantity * 1000) / 1000, // 3 decimales para BTC
    positionSizeUsdt: Math.round(positionSizeUsdt * 100) / 100,
    marginUsdt: Math.round(maxMargin * 100) / 100,
    riskUsdt: Math.round(riskUsdt * 100) / 100,
    riskPct: Math.round(riskPct * 100) / 100,
  };

  logger.info(
    {
      balance,
      confidence,
      balancePct: `${(balancePct * 100).toFixed(0)}%`,
      leverage,
      margin: result.marginUsdt,
      positionSize: result.positionSizeUsdt,
      qty: result.quantity,
      riskUsdt: result.riskUsdt,
      riskPct: result.riskPct,
    },
    'Position size calculado',
  );

  return result;
}
