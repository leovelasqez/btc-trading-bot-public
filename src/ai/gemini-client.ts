/**
 * Cliente Gemini AI — análisis técnico basado en datos (sin imágenes)
 * Envía datos completos de mercado + indicadores y recibe señal de trading
 *
 * Retry strategy:
 *   - Modelo principal (gemini-3.1-pro-preview): 3 retries con backoff 60s, 180s, 300s
 *   - Modelo fallback (gemini-2.5-pro): 1 intento
 *   - Solo retry en errores transitorios (503, fetch failed, timeout, ECONNRESET)
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { buildSystemPrompt, buildAnalysisPrompt, type MarketContext } from './prompt-template.js';
import { parseAiResponse, type AiResponse } from './response-parser.js';
import { buildPositionManagementSystemPrompt, buildPositionManagementPrompt } from './position-prompt.js';
import { parsePositionManagementResponse, type PositionManagementResponse } from './position-response-parser.js';
import { buildLimitOrderManagementSystemPrompt, buildLimitOrderManagementPrompt } from './limit-order-prompt.js';
import { parseLimitOrderManagementResponse, type LimitOrderManagementResponse } from './limit-order-response-parser.js';
import type { PendingLimitOrder } from './limit-order-prompt.js';
import type { PositionData, TradeCosts } from '../exchange/position-data.js';

const PRIMARY_MODEL = 'gemini-3.1-pro-preview';
const FALLBACK_MODEL = 'gemini-2.5-pro';
const RETRY_DELAYS_MS: readonly [number, number, number] = [60_000, 180_000, 300_000]; // 60s, 180s, 300s

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return genAI;
}

/**
 * Determina si un error es transitorio y merece retry
 */
function isTransientError(errorMsg: string): boolean {
  const transientPatterns = [
    '503',
    'Service Unavailable',
    'fetch failed',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'socket hang up',
    'network',
    'timeout',
    'high demand',
    'overloaded',
    'rate limit',
    '429',
    '500',
    '502',
    '504',
  ];
  const lower = errorMsg.toLowerCase();
  return transientPatterns.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Espera N milisegundos
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Result types ───

interface GeminiSuccess {
  success: true;
  data: AiResponse;
  rawText: string;
  latencyMs: number;
  modelUsed: string;
}

interface GeminiFailure {
  success: false;
  error: string;
  rawText?: string;
  latencyMs: number;
  modelUsed?: string;
}

export type GeminiAnalysisResult = GeminiSuccess | GeminiFailure;

interface GeminiPositionSuccess {
  success: true;
  data: PositionManagementResponse;
  rawText: string;
  latencyMs: number;
  modelUsed: string;
}

export type GeminiPositionResult = GeminiPositionSuccess | GeminiFailure;

interface GeminiLimitOrderSuccess {
  success: true;
  data: LimitOrderManagementResponse;
  rawText: string;
  latencyMs: number;
  modelUsed: string;
}

export type GeminiLimitOrderResult = GeminiLimitOrderSuccess | GeminiFailure;

// ─── Core call with single attempt ───

async function callGeminiForAnalysis(
  modelName: string,
  context: MarketContext,
): Promise<GeminiAnalysisResult> {
  const startTime = Date.now();

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: buildSystemPrompt(),
    });

    const prompt = buildAnalysisPrompt(context);

    logger.info({ model: modelName }, 'Enviando análisis a Gemini (data-only)...');

    const result = await model.generateContent(prompt);
    const response = result.response;
    const rawText = response.text();
    const latencyMs = Date.now() - startTime;

    logger.info({ model: modelName, latencyMs, responseLength: rawText.length }, 'Respuesta de Gemini recibida');
    logger.debug({ rawText }, 'Raw Gemini response');

    const parsed = parseAiResponse(rawText);

    if (!parsed.success) {
      logger.warn({ error: parsed.error, rawText }, 'Respuesta de Gemini inválida');
      return { success: false, error: parsed.error, rawText, latencyMs, modelUsed: modelName };
    }

    logger.info(
      {
        model: modelName,
        signal: parsed.data.signal,
        confidence: parsed.data.confidence,
        entry: parsed.data.entry_price,
        sl: parsed.data.stop_loss,
        tp: parsed.data.take_profit,
        rr: parsed.data.risk_reward_ratio,
      },
      'Señal de Gemini',
    );

    return { success: true, data: parsed.data, rawText, latencyMs, modelUsed: modelName };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : 'Unknown Gemini error';
    logger.error({ error: message, model: modelName, latencyMs }, 'Error al llamar a Gemini');
    return { success: false, error: message, latencyMs, modelUsed: modelName };
  }
}

async function callGeminiForPosition(
  modelName: string,
  context: MarketContext,
  position: PositionData,
  costs: TradeCosts,
  currentSL: number,
  currentTP: number | null,
): Promise<GeminiPositionResult> {
  const startTime = Date.now();

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: buildPositionManagementSystemPrompt(),
    });

    const prompt = buildPositionManagementPrompt(context, position, costs, currentSL, currentTP);

    logger.info({ model: modelName, side: position.side }, 'Enviando gestión de posición a Gemini...');

    const result = await model.generateContent(prompt);
    const response = result.response;
    const rawText = response.text();
    const latencyMs = Date.now() - startTime;

    logger.info({ model: modelName, latencyMs, responseLength: rawText.length }, 'Respuesta de Gemini (posición) recibida');
    logger.debug({ rawText }, 'Raw Gemini position response');

    const parsed = parsePositionManagementResponse(rawText);

    if (!parsed.success) {
      logger.warn({ error: parsed.error, rawText }, 'Respuesta de Gemini (posición) inválida');
      return { success: false, error: parsed.error, rawText, latencyMs, modelUsed: modelName };
    }

    logger.info(
      {
        model: modelName,
        action: parsed.data.action,
        confidence: parsed.data.confidence,
        newSL: parsed.data.new_stop_loss,
        newTP: parsed.data.new_take_profit,
      },
      'Decisión de Gemini para posición',
    );

    return { success: true, data: parsed.data, rawText, latencyMs, modelUsed: modelName };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : 'Unknown Gemini error';
    logger.error({ error: message, model: modelName, latencyMs }, 'Error al llamar a Gemini (posición)');
    return { success: false, error: message, latencyMs, modelUsed: modelName };
  }
}

async function callGeminiForLimitOrder(
  modelName: string,
  context: MarketContext,
  pendingOrder: PendingLimitOrder,
): Promise<GeminiLimitOrderResult> {
  const startTime = Date.now();

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: buildLimitOrderManagementSystemPrompt(),
    });

    const prompt = buildLimitOrderManagementPrompt(context, pendingOrder);

    logger.info({ model: modelName, side: pendingOrder.side }, 'Enviando gestión de orden límite a Gemini...');

    const result = await model.generateContent(prompt);
    const response = result.response;
    const rawText = response.text();
    const latencyMs = Date.now() - startTime;

    logger.info({ model: modelName, latencyMs, responseLength: rawText.length }, 'Respuesta de Gemini (orden límite) recibida');
    logger.debug({ rawText }, 'Raw Gemini limit order response');

    const parsed = parseLimitOrderManagementResponse(rawText);

    if (!parsed.success) {
      logger.warn({ error: parsed.error, rawText }, 'Respuesta de Gemini (orden límite) inválida');
      return { success: false, error: parsed.error, rawText, latencyMs, modelUsed: modelName };
    }

    logger.info(
      {
        model: modelName,
        action: parsed.data.action,
        confidence: parsed.data.confidence,
        newEntry: parsed.data.new_entry_price,
        newSL: parsed.data.new_stop_loss,
        newTP: parsed.data.new_take_profit,
      },
      'Decisión de Gemini para orden límite',
    );

    return { success: true, data: parsed.data, rawText, latencyMs, modelUsed: modelName };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : 'Unknown Gemini error';
    logger.error({ error: message, model: modelName, latencyMs }, 'Error al llamar a Gemini (orden límite)');
    return { success: false, error: message, latencyMs, modelUsed: modelName };
  }
}

// ─── Public API with retry + fallback ───

export async function analyzeWithGemini(
  context: MarketContext,
): Promise<GeminiAnalysisResult> {
  // Intentar modelo principal con retries
  let lastError = '';
  const firstResult = await callGeminiForAnalysis(PRIMARY_MODEL, context);

  if (firstResult.success) return firstResult;
  lastError = firstResult.error;

  // Retry solo si es error transitorio
  if (isTransientError(lastError)) {
    for (const [i, delayMs] of RETRY_DELAYS_MS.entries()) {
      const delaySec = delayMs / 1000;
      logger.warn(
        { attempt: i + 2, delay: `${delaySec}s`, model: PRIMARY_MODEL },
        `Retry ${i + 2}/3 — esperando ${delaySec}s...`,
      );
      await sleep(delayMs);

      const retryResult = await callGeminiForAnalysis(PRIMARY_MODEL, context);
      if (retryResult.success) return retryResult;

      lastError = retryResult.error;
      if (!isTransientError(lastError)) break;
    }
  }

  // Fallback: un solo intento con modelo secundario
  logger.warn(
    { primaryError: lastError, fallbackModel: FALLBACK_MODEL },
    'Modelo principal agotó retries — intentando fallback',
  );

  const fallbackResult = await callGeminiForAnalysis(FALLBACK_MODEL, context);

  if (fallbackResult.success) {
    logger.info({ model: FALLBACK_MODEL }, 'Fallback exitoso');
  } else {
    logger.error(
      { primaryError: lastError, fallbackError: fallbackResult.error },
      'Ambos modelos fallaron',
    );
  }

  return fallbackResult;
}

export async function analyzePositionWithGemini(
  context: MarketContext,
  position: PositionData,
  costs: TradeCosts,
  currentSL: number,
  currentTP: number | null,
): Promise<GeminiPositionResult> {
  // Intentar modelo principal con retries
  let lastError = '';
  const firstResult = await callGeminiForPosition(PRIMARY_MODEL, context, position, costs, currentSL, currentTP);

  if (firstResult.success) return firstResult;
  lastError = firstResult.error;

  // Retry solo si es error transitorio
  if (isTransientError(lastError)) {
    for (const [i, delayMs] of RETRY_DELAYS_MS.entries()) {
      const delaySec = delayMs / 1000;
      logger.warn(
        { attempt: i + 2, delay: `${delaySec}s`, model: PRIMARY_MODEL },
        `Retry posición ${i + 2}/3 — esperando ${delaySec}s...`,
      );
      await sleep(delayMs);

      const retryResult = await callGeminiForPosition(PRIMARY_MODEL, context, position, costs, currentSL, currentTP);
      if (retryResult.success) return retryResult;

      lastError = retryResult.error;
      if (!isTransientError(lastError)) break;
    }
  }

  // Fallback: un solo intento con modelo secundario
  logger.warn(
    { primaryError: lastError, fallbackModel: FALLBACK_MODEL },
    'Modelo principal agotó retries (posición) — intentando fallback',
  );

  const fallbackResult = await callGeminiForPosition(FALLBACK_MODEL, context, position, costs, currentSL, currentTP);

  if (fallbackResult.success) {
    logger.info({ model: FALLBACK_MODEL }, 'Fallback (posición) exitoso');
  } else {
    logger.error(
      { primaryError: lastError, fallbackError: fallbackResult.error },
      'Ambos modelos fallaron (posición)',
    );
  }

  return fallbackResult;
}

export async function analyzeLimitOrderWithGemini(
  context: MarketContext,
  pendingOrder: PendingLimitOrder,
): Promise<GeminiLimitOrderResult> {
  // Intentar modelo principal con retries
  let lastError = '';
  const firstResult = await callGeminiForLimitOrder(PRIMARY_MODEL, context, pendingOrder);

  if (firstResult.success) return firstResult;
  lastError = firstResult.error;

  // Retry solo si es error transitorio
  if (isTransientError(lastError)) {
    for (const [i, delayMs] of RETRY_DELAYS_MS.entries()) {
      const delaySec = delayMs / 1000;
      logger.warn(
        { attempt: i + 2, delay: `${delaySec}s`, model: PRIMARY_MODEL },
        `Retry orden límite ${i + 2}/3 — esperando ${delaySec}s...`,
      );
      await sleep(delayMs);

      const retryResult = await callGeminiForLimitOrder(PRIMARY_MODEL, context, pendingOrder);
      if (retryResult.success) return retryResult;

      lastError = retryResult.error;
      if (!isTransientError(lastError)) break;
    }
  }

  // Fallback: un solo intento con modelo secundario
  logger.warn(
    { primaryError: lastError, fallbackModel: FALLBACK_MODEL },
    'Modelo principal agotó retries (orden límite) — intentando fallback',
  );

  const fallbackResult = await callGeminiForLimitOrder(FALLBACK_MODEL, context, pendingOrder);

  if (fallbackResult.success) {
    logger.info({ model: FALLBACK_MODEL }, 'Fallback (orden límite) exitoso');
  } else {
    logger.error(
      { primaryError: lastError, fallbackError: fallbackResult.error },
      'Ambos modelos fallaron (orden límite)',
    );
  }

  return fallbackResult;
}
