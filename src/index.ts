import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { getExchange } from './exchange/binance.js';
import { getTelegramBot, stopTelegramBot, sendMessage } from './notifications/telegram-bot.js';
import { startScheduler, stopScheduler } from './scheduler/cron.js';
import { resetDailyStats } from './risk/circuit-breaker.js';
import { getBalance } from './exchange/orders.js';
import { startLiquidationCollector, stopLiquidationCollector } from './exchange/liquidation-ws.js';
import { startUserDataStream, stopUserDataStream } from './exchange/user-data-ws.js';
import { registerFillHandler, registerPositionCloseHandler } from './scheduler/analysis-cycle.js';
import { formatBotStatus } from './notifications/alert-formatter.js';
import { getBotState } from './storage/trade-logger.js';
import { checkHealth } from './scheduler/health-check.js';
import { checkStartupSafety } from './startup-checks.js';
import cron from 'node-cron';

async function main() {
  logger.info('=== BTC Futures Trading Bot ===');
  logger.info({
    mode: env.TRADING_MODE,
    testnet: env.BINANCE_TESTNET,
    interval: `${env.ANALYSIS_INTERVAL_MINUTES}m`,
    leverage: `${env.LEVERAGE}x`,
    maxPositionPct: `${env.MAX_POSITION_PCT}%`,
    confidenceThreshold: env.CONFIDENCE_THRESHOLD,
  }, 'Configuración');

  // 1. Conectar a Binance y cargar mercados
  const exchange = getExchange();
  await exchange.loadMarkets();
  logger.info('Mercados cargados');

  // 1.5. Iniciar WebSockets
  startLiquidationCollector();
  startUserDataStream();
  registerFillHandler();
  registerPositionCloseHandler();

  // 1.6. Verificación de seguridad al arrancar: detectar posición sin SL u órdenes huérfanas
  await checkStartupSafety();

  // 2. Obtener balance inicial
  const balance = await getBalance();
  logger.info({ balance }, 'Balance inicial');

  // 3. Resetear stats diarios
  await resetDailyStats(balance);

  // 4. Inicializar Telegram bot
  const bot = getTelegramBot();

  // Comando /status mejorado
  bot.onText(/\/status/, async (msg) => {
    if (String(msg.chat.id) !== env.TELEGRAM_CHAT_ID) return;
    const state = await getBotState();
    const currentBalance = await getBalance();
    const statusMsg = formatBotStatus(
      !state?.is_paused,
      env.TRADING_MODE,
      (state?.daily_pnl as number) ?? 0,
      (state?.daily_trades as number) ?? 0,
    );
    await sendMessage(`${statusMsg}\n💰 Balance: $${currentBalance.toFixed(2)}`);
  });

  // Comando /pause
  bot.onText(/\/pause/, async (msg) => {
    if (String(msg.chat.id) !== env.TELEGRAM_CHAT_ID) return;
    const { updateBotState } = await import('./storage/trade-logger.js');
    await updateBotState({ is_paused: true, pause_reason: 'manual_pause' });
    await sendMessage('⏸️ Bot pausado manualmente. Usa /resume para continuar.');
    logger.info('Bot pausado por comando de Telegram');
  });

  // Comando /resume
  bot.onText(/\/resume/, async (msg) => {
    if (String(msg.chat.id) !== env.TELEGRAM_CHAT_ID) return;
    const { updateBotState } = await import('./storage/trade-logger.js');
    await updateBotState({ is_paused: false, pause_reason: null });
    await sendMessage('▶️ Bot reanudado.');
    logger.info('Bot reanudado por comando de Telegram');
  });

  // 5. Notificar inicio
  await sendMessage(
    `🤖 Bot iniciado\n` +
    `Modo: full-auto\n` +
    `Intervalo: ${env.ANALYSIS_INTERVAL_MINUTES}m\n` +
    `Balance: $${balance.toFixed(2)}\n` +
    `${env.BINANCE_TESTNET === 'true' ? 'Testnet: ⚠️ SI' : 'Mainnet: ✅ SI'}`,
  );

  // 5.5. Health check cada 35 minutos
  cron.schedule('*/35 * * * *', async () => {
    await checkHealth();
  });

  // 6. Scheduler de reset diario (00:00 UTC)
  cron.schedule('0 0 * * *', async () => {
    logger.info('Reset diario de stats');
    const currentBalance = await getBalance();
    await resetDailyStats(currentBalance);
    await sendMessage(`📊 Reset diario — Balance: $${currentBalance.toFixed(2)}`);
  });

  // 7. Iniciar scheduler principal
  startScheduler();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Cerrando bot...');
    stopScheduler();
    stopLiquidationCollector();
    stopUserDataStream();
    await sendMessage('🔴 Bot detenido');
    await stopTelegramBot();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err: unknown) => {
  logger.error(err, 'Error fatal');
  try {
    await sendMessage(`🚨 Error fatal: ${err instanceof Error ? err.message : 'Unknown'}`);
    await stopTelegramBot();
  } catch { /* ignore */ }
  process.exit(1);
});
