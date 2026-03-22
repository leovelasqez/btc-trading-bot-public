export interface Trade {
  id: string;
  created_at: string;
  ai_decision_id: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  entry_price: number;
  quantity: number;
  position_size_usdt: number;
  stop_loss_price: number;
  take_profit_price: number | null;
  status: 'open' | 'closed' | 'cancelled' | 'liquidated';
  exit_price: number | null;
  exit_reason: string | null;
  closed_at: string | null;
  pnl_usdt: number | null;
  pnl_percentage: number | null;
  fees_usdt: number | null;
  execution_mode: 'semi-auto' | 'full-auto';
  binance_order_id: string | null;
  sl_order_id: string | null;
  tp_order_id: string | null;
}

export interface TradeFull extends Trade {
  ai_signal: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  reasoning: string | null;
  model_used: string;
  signal_price: number;
  tf_15m_rsi: number | null;
  tf_4h_rsi: number | null;
  chart_15m_url: string | null;
  chart_4h_url: string | null;
}

export interface AiDecision {
  id: string;
  created_at: string;
  signal_id: string;
  ai_signal: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  reasoning: string | null;
  suggested_entry: number | null;
  suggested_stop_loss: number | null;
  suggested_take_profit: number | null;
  model_used: string;
  latency_ms: number | null;
  accepted: boolean;
  rejection_reason: string | null;
}

export interface BotState {
  id: number;
  updated_at: string;
  trading_mode: 'semi-auto' | 'full-auto';
  is_paused: boolean;
  pause_reason: string | null;
  daily_pnl: number;
  daily_trades: number;
  daily_wins: number;
  daily_losses: number;
  current_balance: number | null;
  start_of_day_balance: number | null;
  last_analysis_at: string | null;
  last_trade_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export interface DailyStats {
  trade_date: string;
  total_trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  total_pnl: number;
  avg_pnl_pct: number;
  best_trade: number;
  worst_trade: number;
}
