/**
 * Genera imágenes PNG de charts con velas japonesas usando @napi-rs/canvas
 * Incluye: candlesticks, EMAs, volumen, RSI, MACD
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Candle } from '../exchange/candles.js';
import type { TimeframeIndicators } from '../ai/prompt-template.js';
import { logger } from '../config/logger.js';

const WIDTH = 1200;
const HEIGHT = 800;

// Layout vertical
const PADDING = 60;
const CANDLE_AREA_TOP = PADDING;
const CANDLE_AREA_BOTTOM = HEIGHT * 0.55;
const VOLUME_AREA_TOP = CANDLE_AREA_BOTTOM + 10;
const VOLUME_AREA_BOTTOM = HEIGHT * 0.7;
const RSI_AREA_TOP = VOLUME_AREA_BOTTOM + 10;
const RSI_AREA_BOTTOM = HEIGHT * 0.82;
const MACD_AREA_TOP = RSI_AREA_BOTTOM + 10;
const MACD_AREA_BOTTOM = HEIGHT - 20;

const COLORS = {
  bg: '#1a1a2e',
  grid: '#2a2a4a',
  text: '#a0a0c0',
  bullish: '#26a69a',
  bearish: '#ef5350',
  ema9: '#ffeb3b',
  ema21: '#2196f3',
  ema50: '#ff9800',
  ema200: '#e91e63',
  volume: '#3a3a5a',
  rsiLine: '#ab47bc',
  macdLine: '#2196f3',
  macdSignal: '#ff9800',
  macdHistPos: '#26a69a',
  macdHistNeg: '#ef5350',
};

interface ChartOptions {
  title: string;
  candles: Candle[];
  indicators: TimeframeIndicators;
}

export function generateChartImage(options: ChartOptions): Buffer {
  const { title, candles, indicators } = options;
  const displayCandles = candles.slice(-100); // Últimas 100 velas

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px monospace';
  ctx.fillText(title, PADDING, 25);

  // Price info
  const lastCandle = displayCandles.at(-1)!;
  const priceColor = lastCandle.close >= lastCandle.open ? COLORS.bullish : COLORS.bearish;
  ctx.fillStyle = priceColor;
  ctx.font = 'bold 14px monospace';
  ctx.fillText(`$${lastCandle.close.toFixed(1)}`, PADDING + 400, 25);

  // Draw sections
  drawCandlesticks(ctx, displayCandles);
  drawEMAs(ctx, displayCandles, indicators);
  drawVolume(ctx, displayCandles);
  drawRSI(ctx, displayCandles, indicators.rsi);
  drawMACD(ctx, indicators);

  // Section labels
  ctx.fillStyle = COLORS.text;
  ctx.font = '11px monospace';
  ctx.fillText('Volume', PADDING, VOLUME_AREA_TOP + 12);
  ctx.fillText(`RSI(14): ${indicators.rsi.toFixed(1)}`, PADDING, RSI_AREA_TOP + 12);
  ctx.fillText('MACD', PADDING, MACD_AREA_TOP + 12);

  // EMA legend
  drawLegend(ctx, indicators);

  const buffer = canvas.toBuffer('image/png');
  logger.info({ title, size: buffer.length }, 'Chart generado');
  return buffer;
}

function drawCandlesticks(
  ctx: any,
  candles: Candle[],
) {
  const areaWidth = WIDTH - PADDING * 2;
  const areaHeight = CANDLE_AREA_BOTTOM - CANDLE_AREA_TOP;
  const candleWidth = Math.max(2, (areaWidth / candles.length) * 0.7);
  const gap = areaWidth / candles.length;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = maxPrice - minPrice || 1;

  // Grid lines
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = CANDLE_AREA_TOP + (areaHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(PADDING, y);
    ctx.lineTo(WIDTH - PADDING, y);
    ctx.stroke();

    const price = maxPrice - (priceRange / 4) * i;
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px monospace';
    ctx.fillText(`$${price.toFixed(0)}`, WIDTH - PADDING + 5, y + 4);
  }

  // Candles
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const x = PADDING + gap * i + gap / 2;
    const isBullish = c.close >= c.open;

    const bodyTop = CANDLE_AREA_TOP + ((maxPrice - Math.max(c.open, c.close)) / priceRange) * areaHeight;
    const bodyBottom = CANDLE_AREA_TOP + ((maxPrice - Math.min(c.open, c.close)) / priceRange) * areaHeight;
    const wickTop = CANDLE_AREA_TOP + ((maxPrice - c.high) / priceRange) * areaHeight;
    const wickBottom = CANDLE_AREA_TOP + ((maxPrice - c.low) / priceRange) * areaHeight;

    const color = isBullish ? COLORS.bullish : COLORS.bearish;

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, wickTop);
    ctx.lineTo(x, wickBottom);
    ctx.stroke();

    // Body
    ctx.fillStyle = color;
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  }
}

function drawEMAs(
  ctx: any,
  candles: Candle[],
  indicators: TimeframeIndicators,
) {
  const areaWidth = WIDTH - PADDING * 2;
  const areaHeight = CANDLE_AREA_BOTTOM - CANDLE_AREA_TOP;
  const gap = areaWidth / candles.length;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const priceRange = maxPrice - minPrice || 1;

  // We only draw the current EMA values as horizontal reference lines
  const emas: Array<{ value: number; color: string; label: string }> = [
    { value: indicators.ema_9, color: COLORS.ema9, label: 'EMA9' },
    { value: indicators.ema_21, color: COLORS.ema21, label: 'EMA21' },
  ];
  if (indicators.ema_200 !== undefined) {
    emas.push({ value: indicators.ema_200, color: COLORS.ema200, label: 'EMA200' });
  }

  for (const ema of emas) {
    if (ema.value < minPrice || ema.value > maxPrice) continue;
    const y = CANDLE_AREA_TOP + ((maxPrice - ema.value) / priceRange) * areaHeight;
    ctx.strokeStyle = ema.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING, y);
    ctx.lineTo(WIDTH - PADDING, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawVolume(
  ctx: any,
  candles: Candle[],
) {
  const areaWidth = WIDTH - PADDING * 2;
  const areaHeight = VOLUME_AREA_BOTTOM - VOLUME_AREA_TOP;
  const gap = areaWidth / candles.length;
  const barWidth = Math.max(2, gap * 0.7);

  const maxVol = Math.max(...candles.map((c) => c.volume));
  if (maxVol === 0) return;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const x = PADDING + gap * i + gap / 2;
    const barH = (c.volume / maxVol) * areaHeight;
    const isBullish = c.close >= c.open;

    ctx.fillStyle = isBullish ? COLORS.bullish + '80' : COLORS.bearish + '80';
    ctx.fillRect(x - barWidth / 2, VOLUME_AREA_BOTTOM - barH, barWidth, barH);
  }
}

function drawRSI(
  ctx: any,
  candles: Candle[],
  currentRSI: number,
) {
  const areaHeight = RSI_AREA_BOTTOM - RSI_AREA_TOP;

  // Overbought/Oversold zones
  const ob = RSI_AREA_TOP + ((100 - 70) / 100) * areaHeight;
  const os = RSI_AREA_TOP + ((100 - 30) / 100) * areaHeight;

  ctx.fillStyle = COLORS.bearish + '20';
  ctx.fillRect(PADDING, RSI_AREA_TOP, WIDTH - PADDING * 2, ob - RSI_AREA_TOP);
  ctx.fillStyle = COLORS.bullish + '20';
  ctx.fillRect(PADDING, os, WIDTH - PADDING * 2, RSI_AREA_BOTTOM - os);

  // 70/30 lines
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  for (const level of [ob, os]) {
    ctx.beginPath();
    ctx.moveTo(PADDING, level);
    ctx.lineTo(WIDTH - PADDING, level);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Current RSI marker
  const rsiY = RSI_AREA_TOP + ((100 - currentRSI) / 100) * areaHeight;
  ctx.fillStyle = COLORS.rsiLine;
  ctx.beginPath();
  ctx.arc(WIDTH - PADDING - 10, rsiY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Labels
  ctx.fillStyle = COLORS.text;
  ctx.font = '9px monospace';
  ctx.fillText('70', WIDTH - PADDING + 5, ob + 3);
  ctx.fillText('30', WIDTH - PADDING + 5, os + 3);
}

function drawMACD(
  ctx: any,
  indicators: TimeframeIndicators,
) {
  const macd = { line: 0, signal: 0, histogram: 0 }; // Chart generator no longer used
  const areaHeight = MACD_AREA_BOTTOM - MACD_AREA_TOP;
  const midY = MACD_AREA_TOP + areaHeight / 2;

  // Zero line
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(PADDING, midY);
  ctx.lineTo(WIDTH - PADDING, midY);
  ctx.stroke();

  // Histogram bar (single current value)
  const maxVal = Math.max(Math.abs(macd.histogram), 0.001);
  const barH = (Math.abs(macd.histogram) / maxVal) * (areaHeight / 2) * 0.8;
  const barX = WIDTH - PADDING - 30;
  const barColor = macd.histogram >= 0 ? COLORS.macdHistPos : COLORS.macdHistNeg;

  ctx.fillStyle = barColor;
  if (macd.histogram >= 0) {
    ctx.fillRect(barX - 8, midY - barH, 16, barH);
  } else {
    ctx.fillRect(barX - 8, midY, 16, barH);
  }

  // MACD values text
  ctx.fillStyle = COLORS.text;
  ctx.font = '10px monospace';
  ctx.fillText(`MACD: ${macd.line.toFixed(2)}  Signal: ${macd.signal.toFixed(2)}  Hist: ${macd.histogram.toFixed(2)}`, PADDING + 40, MACD_AREA_TOP + 12);
}

function drawLegend(
  ctx: any,
  indicators: TimeframeIndicators,
) {
  const items: Array<{ label: string; color: string; value: string }> = [
    { label: 'EMA9', color: COLORS.ema9, value: `$${indicators.ema_9.toFixed(1)}` },
    { label: 'EMA21', color: COLORS.ema21, value: `$${indicators.ema_21.toFixed(1)}` },
  ];
  if (indicators.ema_200 !== undefined) {
    items.push({ label: 'EMA200', color: COLORS.ema200, value: `$${indicators.ema_200.toFixed(1)}` });
  }

  let x = PADDING;
  const y = 45;
  ctx.font = '10px monospace';

  for (const item of items) {
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y - 6, 10, 3);
    x += 14;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${item.label}: ${item.value}`, x, y);
    x += 130;
  }
}
