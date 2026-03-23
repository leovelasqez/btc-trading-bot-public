/**
 * Trade Logger — registra señales, decisiones AI y trades en Supabase
 */
import { getSupabase } from './supabase-client.js';
import { logger } from '../config/logger.js';
import type { MarketContext } from '../ai/prompt-template.js';
import type { AiResponse } from '../ai/response-parser.js';

/** Parsea rawText de Gemini para guardar en Supabase (columna JSONB). Limpia markdown si es necesario. */
function safeParseRaw(text: string): unknown {
  try {
    let cleaned = text.trim();
    const blockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (blockMatch) cleaned = blockMatch[1]!.trim();
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) cleaned = objMatch[0];
    return JSON.parse(cleaned);
  } catch {
    return { raw: text };
  }
}

// ─── Signal logging ───

export interface LogSignalInput {
  context: MarketContext;
  chartUrls?: { chart_15m_url?: string; chart_4h_url?: string };
}

export async function logSignal(input: LogSignalInput): Promise<string> {
  const { context, chartUrls } = input;
  const { tf_15m, tf_4h } = context.indicators;

  const { data, error } = await getSupabase()
    .from('signals')
    .insert({
      btc_price: context.currentPrice,
      funding_rate: context.fundingRate,
      // 15m
      tf_15m_rsi: tf_15m.rsi,
      tf_15m_ema_9: tf_15m.ema_9,
      tf_15m_ema_21: tf_15m.ema_21,
      tf_15m_ema_50: tf_15m.ema_50,
      tf_15m_macd_line: tf_15m.macd.line,
      tf_15m_macd_signal: tf_15m.macd.signal,
      tf_15m_macd_histogram: tf_15m.macd.histogram,
      tf_15m_volume: tf_15m.volume,
      // 4h
      tf_4h_rsi: tf_4h.rsi,
      tf_4h_ema_9: tf_4h.ema_9,
      tf_4h_ema_21: tf_4h.ema_21,
      tf_4h_ema_50: tf_4h.ema_50,
      tf_4h_ema_200: tf_4h.ema_200 ?? null,
      tf_4h_macd_line: tf_4h.macd.line,
      tf_4h_macd_signal: tf_4h.macd.signal,
      tf_4h_macd_histogram: tf_4h.macd.histogram,
      tf_4h_volume: tf_4h.volume,
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ error: error.message }, 'Error al guardar signal en Supabase');
    throw new Error(`Supabase signal insert failed: ${error.message}`);
  }

  logger.info({ signalId: data.id }, 'Signal guardada en Supabase');
  return data.id as string;
}

// ─── AI Decision logging ───

export interface LogAiDecisionInput {
  signalId: string;
  aiResponse: AiResponse;
  accepted: boolean;
  rejectionReason?: string;
  latencyMs: number;
  rawResponse: string;
  modelUsed?: string;
}

export async function logAiDecision(input: LogAiDecisionInput): Promise<string> {
  const { signalId, aiResponse, accepted, rejectionReason, latencyMs, rawResponse } = input;

  const { data, error } = await getSupabase()
    .from('ai_decisions')
    .insert({
      signal_id: signalId,
      ai_signal: aiResponse.signal,
      confidence: aiResponse.confidence,
      reasoning: aiResponse.reasoning,
      suggested_entry: aiResponse.entry_price,
      suggested_stop_loss: aiResponse.stop_loss,
      suggested_take_profit: aiResponse.take_profit,
      model_used: input.modelUsed ?? 'gemini-3.1-pro-preview',
      latency_ms: latencyMs,
      raw_response: safeParseRaw(rawResponse),
      accepted,
      rejection_reason: rejectionReason ?? null,
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ error: error.message }, 'Error al guardar AI decision en Supabase');
    throw new Error(`Supabase ai_decision insert failed: ${error.message}`);
  }

  logger.info({ decisionId: data.id, signal: aiResponse.signal, accepted }, 'AI decision guardada');
  return data.id as string;
}

// ─── Trade logging ───

export interface LogTradeInput {
  aiDecisionId: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  entryPrice: number;
  quantity: number;
  positionSizeUsdt: number;
  stopLossPrice: number;
  takeProfitPrice: number | null;
  executionMode: 'semi-auto' | 'full-auto';
  binanceOrderId?: string;
  slOrderId?: string;
  tpOrderId?: string;
}

export async function logTradeOpen(input: LogTradeInput): Promise<string> {
  const { data, error } = await getSupabase()
    .from('trades')
    .insert({
      ai_decision_id: input.aiDecisionId,
      side: input.side,
      leverage: input.leverage,
      entry_price: input.entryPrice,
      quantity: input.quantity,
      position_size_usdt: input.positionSizeUsdt,
      stop_loss_price: input.stopLossPrice,
      take_profit_price: input.takeProfitPrice,
      status: 'open',
      execution_mode: input.executionMode,
      binance_order_id: input.binanceOrderId ?? null,
      sl_order_id: input.slOrderId ?? null,
      tp_order_id: input.tpOrderId ?? null,
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ error: error.message }, 'Error al guardar trade en Supabase');
    throw new Error(`Supabase trade insert failed: ${error.message}`);
  }

  logger.info({ tradeId: data.id, side: input.side }, 'Trade abierto guardado');
  return data.id as string;
}

// ─── Trade close ───

export interface CloseTradeInput {
  tradeId: string;
  exitPrice: number;
  exitReason: 'take_profit' | 'stop_loss' | 'manual' | 'circuit_breaker' | 'trailing_stop';
  pnlUsdt: number;
  pnlPercentage: number;
  feesUsdt?: number;
}

export async function logTradeClose(input: CloseTradeInput): Promise<void> {
  const { error } = await getSupabase()
    .from('trades')
    .update({
      status: 'closed',
      exit_price: input.exitPrice,
      exit_reason: input.exitReason,
      closed_at: new Date().toISOString(),
      pnl_usdt: input.pnlUsdt,
      pnl_percentage: input.pnlPercentage,
      fees_usdt: input.feesUsdt ?? null,
    })
    .eq('id', input.tradeId);

  if (error) {
    logger.error({ error: error.message, tradeId: input.tradeId }, 'Error al cerrar trade');
    throw new Error(`Supabase trade close failed: ${error.message}`);
  }

  logger.info(
    { tradeId: input.tradeId, pnl: input.pnlUsdt, reason: input.exitReason },
    'Trade cerrado',
  );
}

// ─── Bot state ───

export async function updateBotState(updates: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabase()
    .from('bot_state')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', 1);

  if (error) {
    logger.error({ error: error.message }, 'Error al actualizar bot_state');
  }
}

export async function getBotState(): Promise<Record<string, unknown> | null> {
  const { data, error } = await getSupabase()
    .from('bot_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    logger.error({ error: error.message }, 'Error al leer bot_state');
    return null;
  }

  return data as Record<string, unknown>;
}

// ─── Position adjustments ───

export interface LogPositionAdjustmentInput {
  tradeId: string;
  adjustmentType: 'sl_adjusted' | 'tp_adjusted' | 'sl_tp_adjusted' | 'position_closed' | 'hold';
  previousSL: number | null;
  previousTP: number | null;
  newSL: number | null;
  newTP: number | null;
  aiConfidence: number;
  aiReasoning: string;
  aiRawResponse: string;
  btcPrice: number;
  unrealizedPnl: number;
  fundingFeesAccumulated: number;
  netBreakeven: number;
  executed: boolean;
  executionError?: string;
  modelUsed?: string;
}

export async function logPositionAdjustment(input: LogPositionAdjustmentInput): Promise<string> {
  const { data, error } = await getSupabase()
    .from('position_adjustments')
    .insert({
      trade_id: input.tradeId,
      adjustment_type: input.adjustmentType,
      previous_sl: input.previousSL,
      previous_tp: input.previousTP,
      new_sl: input.newSL,
      new_tp: input.newTP,
      ai_confidence: input.aiConfidence,
      ai_reasoning: input.aiReasoning,
      ai_raw_response: safeParseRaw(input.aiRawResponse),
      btc_price: input.btcPrice,
      unrealized_pnl: input.unrealizedPnl,
      funding_fees_accumulated: input.fundingFeesAccumulated,
      net_breakeven: input.netBreakeven,
      executed: input.executed,
      execution_error: input.executionError ?? null,
      model_used: input.modelUsed ?? 'gemini-3.1-pro-preview',
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ error: error.message }, 'Error al guardar position adjustment en Supabase');
    throw new Error(`Supabase position_adjustment insert failed: ${error.message}`);
  }

  logger.info(
    { adjustmentId: data.id, type: input.adjustmentType, executed: input.executed },
    'Position adjustment guardado',
  );
  return data.id as string;
}

/**
 * Obtiene el trade abierto actual de Supabase
 */
export async function getOpenTrade(): Promise<{
  id: string;
  side: 'LONG' | 'SHORT';
  entry_price: number;
  quantity: number;
  stop_loss_price: number;
  take_profit_price: number | null;
  created_at: string;
} | null> {
  const { data, error } = await getSupabase()
    .from('trades')
    .select('id, side, entry_price, quantity, stop_loss_price, take_profit_price, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error({ error: error.message }, 'Error al buscar trade abierto');
    return null;
  }

  if (!data) return null;

  return {
    id: data.id as string,
    side: data.side as 'LONG' | 'SHORT',
    entry_price: Number(data.entry_price),
    quantity: Number(data.quantity),
    stop_loss_price: Number(data.stop_loss_price),
    take_profit_price: data.take_profit_price ? Number(data.take_profit_price) : null,
    created_at: data.created_at as string,
  };
}

/**
 * Actualiza el SL/TP de un trade abierto en Supabase
 */
export async function updateTradeSLTP(
  tradeId: string,
  updates: { stopLossPrice?: number; takeProfitPrice?: number | null },
): Promise<void> {
  const updateData: Record<string, unknown> = {};
  if (updates.stopLossPrice !== undefined) updateData.stop_loss_price = updates.stopLossPrice;
  if (updates.takeProfitPrice !== undefined) updateData.take_profit_price = updates.takeProfitPrice;

  const { error } = await getSupabase()
    .from('trades')
    .update(updateData)
    .eq('id', tradeId);

  if (error) {
    logger.error({ error: error.message, tradeId }, 'Error al actualizar SL/TP del trade');
    throw new Error(`Supabase trade SL/TP update failed: ${error.message}`);
  }

  logger.info({ tradeId, ...updates }, 'Trade SL/TP actualizado en Supabase');
}

// ─── Circuit breaker events ───

export async function logCircuitBreakerEvent(
  eventType: string,
  details: Record<string, unknown>,
  dailyPnl: number,
  tradesToday: number,
  botPaused: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('circuit_breaker_events')
    .insert({
      event_type: eventType,
      details,
      daily_pnl: dailyPnl,
      trades_today: tradesToday,
      bot_paused: botPaused,
    });

  if (error) {
    logger.error({ error: error.message }, 'Error al guardar circuit breaker event');
  }
}
