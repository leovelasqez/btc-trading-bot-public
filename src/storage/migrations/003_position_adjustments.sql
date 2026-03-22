-- ============================================
-- Position Adjustments — historial de ajustes de SL/TP
-- ============================================

CREATE TABLE IF NOT EXISTS position_adjustments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  trade_id UUID REFERENCES trades(id) NOT NULL,

  -- Tipo de ajuste
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
    'sl_adjusted', 'tp_adjusted', 'sl_tp_adjusted', 'position_closed', 'hold'
  )),

  -- Valores anteriores
  previous_sl DECIMAL(12,2),
  previous_tp DECIMAL(12,2),

  -- Valores nuevos
  new_sl DECIMAL(12,2),
  new_tp DECIMAL(12,2),

  -- AI reasoning
  ai_confidence INTEGER,
  ai_reasoning TEXT,
  ai_raw_response JSONB,

  -- Estado del mercado al momento del ajuste
  btc_price DECIMAL(12,2),
  unrealized_pnl DECIMAL(12,2),
  funding_fees_accumulated DECIMAL(12,4),
  net_breakeven DECIMAL(12,2),

  -- Ejecución
  executed BOOLEAN NOT NULL DEFAULT false,
  execution_error TEXT
);

-- Índices
CREATE INDEX idx_position_adjustments_trade_id ON position_adjustments(trade_id);
CREATE INDEX idx_position_adjustments_created_at ON position_adjustments(created_at DESC);

-- Realtime para dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE position_adjustments;
