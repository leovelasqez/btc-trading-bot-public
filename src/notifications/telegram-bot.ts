/**
 * Telegram Bot — alertas con botones inline para modo semi-auto
 */
import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let bot: TelegramBot | null = null;

export type CallbackAction = 'execute_trade' | 'reject_trade';

export interface CallbackData {
  action: CallbackAction;
  decisionId: string;
}

// Callbacks registrados para manejar respuestas de botones
type TradeCallbackHandler = (decisionId: string, action: CallbackAction) => Promise<void>;
let tradeCallbackHandler: TradeCallbackHandler | null = null;

export function onTradeCallback(handler: TradeCallbackHandler): void {
  tradeCallbackHandler = handler;
}

export function getTelegramBot(): TelegramBot {
  if (bot) return bot;

  bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });

  // Manejar errores de polling (ECONNRESET, ETIMEDOUT, etc.)
  bot.on('polling_error', (error) => {
    logger.warn({ error: error.message }, 'Telegram polling error (auto-retry)');
  });

  // Manejar callback queries (botones inline)
  bot.on('callback_query', async (query) => {
    if (!query.data || !query.message) return;

    try {
      // Formato compacto: "ex:abcd1234" o "rj:abcd1234"
      const [prefix, shortId] = query.data.split(':');
      if (!prefix || !shortId) return;
      const action: CallbackAction = prefix === 'ex' ? 'execute_trade' : 'reject_trade';
      const data: CallbackData = { action, decisionId: shortId };
      logger.info({ action: data.action, decisionId: data.decisionId }, 'Callback recibido de Telegram');

      if (data.action === 'execute_trade') {
        await bot!.answerCallbackQuery(query.id, { text: '✅ Ejecutando trade...' });
        await bot!.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '✅ EJECUTADO', callback_data: 'done' }]] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id },
        );
      } else {
        await bot!.answerCallbackQuery(query.id, { text: '❌ Trade ignorado' });
        await bot!.editMessageReplyMarkup(
          { inline_keyboard: [[{ text: '❌ IGNORADO', callback_data: 'done' }]] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id },
        );
      }

      if (tradeCallbackHandler) {
        await tradeCallbackHandler(data.decisionId, data.action);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error: msg }, 'Error procesando callback de Telegram');
      await bot!.answerCallbackQuery(query.id, { text: '⚠️ Error procesando' });
    }
  });

  // Comando /mode
  bot.onText(/\/mode/, async (msg) => {
    if (String(msg.chat.id) !== env.TELEGRAM_CHAT_ID) return;
    await bot!.sendMessage(msg.chat.id, `📋 Modo actual: ${env.TRADING_MODE}`);
  });

  logger.info('Telegram bot inicializado con polling');
  return bot;
}

/**
 * Envía alerta con botones de acción (semi-auto)
 */
export async function sendSignalAlert(
  message: string,
  decisionId: string,
  hasTradeableSignal: boolean,
): Promise<void> {
  const telegramBot = getTelegramBot();

  const options: TelegramBot.SendMessageOptions = {
    parse_mode: undefined, // plain text para evitar problemas con caracteres especiales
  };

  if (hasTradeableSignal) {
    // Telegram callback_data max 64 bytes — usar formato compacto
    const shortId = decisionId.slice(0, 8);
    options.reply_markup = {
      inline_keyboard: [
        [
          { text: '✅ Ejecutar Trade', callback_data: `ex:${shortId}` },
          { text: '❌ Ignorar', callback_data: `rj:${shortId}` },
        ],
      ],
    };
  }

  await telegramBot.sendMessage(env.TELEGRAM_CHAT_ID, message, options);
  logger.info({ decisionId, hasButtons: hasTradeableSignal }, 'Alerta enviada a Telegram');
}

/**
 * Envía imagen de chart a Telegram
 */
export async function sendChartImage(
  imageBuffer: Buffer,
  caption: string,
): Promise<void> {
  const telegramBot = getTelegramBot();
  await telegramBot.sendPhoto(env.TELEGRAM_CHAT_ID, imageBuffer, { caption });
}

/**
 * Envía mensaje simple
 */
export async function sendMessage(text: string): Promise<void> {
  const telegramBot = getTelegramBot();
  await telegramBot.sendMessage(env.TELEGRAM_CHAT_ID, text);
}

/**
 * Detiene el bot de Telegram (para cleanup)
 */
export async function stopTelegramBot(): Promise<void> {
  if (bot) {
    await bot.stopPolling();
    bot = null;
    logger.info('Telegram bot detenido');
  }
}
