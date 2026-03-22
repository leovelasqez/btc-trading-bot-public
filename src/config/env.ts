import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Binance
  BINANCE_API_KEY: z.string().min(1, 'BINANCE_API_KEY is required'),
  BINANCE_API_SECRET: z.string().min(1, 'BINANCE_API_SECRET is required'),
  BINANCE_TESTNET: z.enum(['true', 'false']).default('true'),

  // Gemini AI
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),

  // Supabase
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // Bot Config
  TRADING_MODE: z.enum(['semi-auto', 'full-auto']).default('semi-auto'),
  LEVERAGE: z.coerce.number().int().min(1).max(20).default(5),
  MAX_POSITION_PCT: z.coerce.number().min(1).max(100).default(100),
  MAX_DAILY_LOSS_PCT: z.coerce.number().min(1).max(20).default(5),
  MAX_TRADES_PER_DAY: z.coerce.number().int().min(1).max(50).default(10),
  ANALYSIS_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(240).default(30),
  CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(80),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Safety check: warn if testnet is disabled
  if (result.data.BINANCE_TESTNET === 'false') {
    console.warn('⚠️  ¡¡¡ BINANCE TESTNET ESTÁ DESACTIVADO — OPERANDO CON DINERO REAL !!!');
    console.warn('⚠️  Esperando 10 segundos para cancelar si esto es un error...');
  }

  return result.data;
}

export const env = loadEnv();
