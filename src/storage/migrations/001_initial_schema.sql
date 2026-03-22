-- ============================================
-- BTC Trading Bot — Supabase Schema
-- ============================================

-- 1. Señales generadas por el análisis técnico
CREATE TABLE IF NOT EXISTS signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Datos del mercado al momento de la señal
  btc_price DECIMAL(12,2) NOT NULL,
  funding_rate DECIMAL(10,6),
  
  -- Indicadores 15m
  tf_15m_rsi DECIMAL(6,2),
  tf_15m_ema_9 DECIMAL(12,2),
  tf_15m_ema_21 DECIMAL(12,2),
  tf_15m_ema_50 DECIMAL(12,2),
  tf_15m_macd_line DECIMAL(12,4),
  tf_15m_macd_signal DECIMAL(12,4),
  tf_15m_macd_histogram DECIMAL(12,4),
  tf_15m_volume DECIMAL(18,2),
  
  -- Indicadores 4h
  tf_4h_rsi DECIMAL(6,2),
  tf_4h_ema_9 DECIMAL(12,2),
  tf_4h_ema_21 DECIMAL(12,2),
  tf_4h_ema_50 DECIMAL(12,2),
  tf_4h_ema_200 DECIMAL(12,2),
  tf_4h_macd_line DECIMAL(12,4),
  tf_4h_macd_signal DECIMAL(12,4),
  tf_4h_macd_histogram DECIMAL(12,4),
  tf_4h_volume DECIMAL(18,2),
  
  -- Charts generados (URLs de storage)
  chart_15m_url TEXT,
  chart_4h_url TEXT
);

-- 2. Respuestas de Gemini AI
CREATE TABLE IF NOT EXISTS ai_decisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  signal_id UUID REFERENCES signals(id) NOT NULL,
  
  -- Respuesta de Gemini
  ai_signal TEXT NOT NULL CHECK (ai_signal IN ('LONG', 'SHORT', 'WAIT')),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasoning TEXT,
  suggested_entry DECIMAL(12,2),
  suggested_stop_loss DECIMAL(12,2),
  suggested_take_profit DECIMAL(12,2),
  
  -- Metadata
  model_used TEXT DEFAULT 'gemini-2.0-flash',
  prompt_tokens INTEGER,
  response_tokens INTEGER,
  latency_ms INTEGER,
  raw_response JSONB,
  
  -- Si fue aceptado o rechazado por el sistema
  accepted BOOLEAN NOT NULL DEFAULT false,
  rejection_reason TEXT -- 'low_confidence', 'circuit_breaker', 'user_rejected', etc.
);

-- 3. Trades ejecutados
CREATE TABLE IF NOT EXISTS trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ai_decision_id UUID REFERENCES ai_decisions(id) NOT NULL,
  
  -- Detalles de la orden
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  leverage INTEGER NOT NULL DEFAULT 5,
  entry_price DECIMAL(12,2) NOT NULL,
  quantity DECIMAL(18,8) NOT NULL,
  position_size_usdt DECIMAL(12,2) NOT NULL,
  
  -- Stop Loss y Take Profit
  stop_loss_price DECIMAL(12,2) NOT NULL,
  take_profit_price DECIMAL(12,2),
  
  -- Estado
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled', 'liquidated')),
  exit_price DECIMAL(12,2),
  exit_reason TEXT, -- 'take_profit', 'stop_loss', 'manual', 'circuit_breaker', 'trailing_stop'
  closed_at TIMESTAMPTZ,
  
  -- PnL
  pnl_usdt DECIMAL(12,2),
  pnl_percentage DECIMAL(8,4),
  fees_usdt DECIMAL(12,4),
  
  -- Ejecución
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('semi-auto', 'full-auto')),
  binance_order_id TEXT,
  
  -- IDs de Binance para SL/TP
  sl_order_id TEXT,
  tp_order_id TEXT
);

-- 4. Circuit breaker log
CREATE TABLE IF NOT EXISTS circuit_breaker_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  event_type TEXT NOT NULL CHECK (event_type IN (
    'max_daily_loss', 'max_trades_reached', 'api_failure', 
    'consecutive_losses', 'manual_pause', 'resumed'
  )),
  details JSONB,
  daily_pnl DECIMAL(12,2),
  trades_today INTEGER,
  bot_paused BOOLEAN NOT NULL DEFAULT false
);

-- 5. Estado del bot (singleton)
CREATE TABLE IF NOT EXISTS bot_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Solo un row
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  trading_mode TEXT NOT NULL DEFAULT 'semi-auto' CHECK (trading_mode IN ('semi-auto', 'full-auto')),
  is_paused BOOLEAN NOT NULL DEFAULT false,
  pause_reason TEXT,
  
  -- Stats del día
  daily_pnl DECIMAL(12,2) DEFAULT 0,
  daily_trades INTEGER DEFAULT 0,
  daily_wins INTEGER DEFAULT 0,
  daily_losses INTEGER DEFAULT 0,
  
  -- Balance tracking
  current_balance DECIMAL(14,2),
  start_of_day_balance DECIMAL(14,2),
  
  -- Última actividad
  last_analysis_at TIMESTAMPTZ,
  last_trade_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ
);

-- Insert default bot state
INSERT INTO bot_state (id, trading_mode, is_paused) 
VALUES (1, 'semi-auto', false)
ON CONFLICT (id) DO NOTHING;

-- 6. Índices para performance
CREATE INDEX idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX idx_ai_decisions_created_at ON ai_decisions(created_at DESC);
CREATE INDEX idx_ai_decisions_signal_id ON ai_decisions(signal_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX idx_trades_ai_decision_id ON trades(ai_decision_id);
CREATE INDEX idx_circuit_breaker_created_at ON circuit_breaker_events(created_at DESC);

-- 7. Vista para dashboard: trades con contexto completo
CREATE OR REPLACE VIEW trades_full AS
SELECT 
  t.*,
  ad.ai_signal,
  ad.confidence,
  ad.reasoning,
  ad.model_used,
  s.btc_price AS signal_price,
  s.tf_15m_rsi,
  s.tf_4h_rsi,
  s.chart_15m_url,
  s.chart_4h_url
FROM trades t
JOIN ai_decisions ad ON t.ai_decision_id = ad.id
JOIN signals s ON ad.signal_id = s.id
ORDER BY t.created_at DESC;

-- 8. Vista para stats diarios
CREATE OR REPLACE VIEW daily_stats AS
SELECT 
  DATE(created_at) AS trade_date,
  COUNT(*) AS total_trades,
  COUNT(*) FILTER (WHERE pnl_usdt > 0) AS wins,
  COUNT(*) FILTER (WHERE pnl_usdt < 0) AS losses,
  COUNT(*) FILTER (WHERE pnl_usdt = 0) AS breakeven,
  ROUND(SUM(pnl_usdt)::numeric, 2) AS total_pnl,
  ROUND(AVG(pnl_percentage)::numeric, 4) AS avg_pnl_pct,
  ROUND(MAX(pnl_usdt)::numeric, 2) AS best_trade,
  ROUND(MIN(pnl_usdt)::numeric, 2) AS worst_trade
FROM trades
WHERE status = 'closed'
GROUP BY DATE(created_at)
ORDER BY trade_date DESC;

-- 9. Enable Realtime para el dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_decisions;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_state;
ALTER PUBLICATION supabase_realtime ADD TABLE circuit_breaker_events;
