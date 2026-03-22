-- Add 'paper' as valid execution_mode for trades
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_execution_mode_check;
ALTER TABLE trades ADD CONSTRAINT trades_execution_mode_check
  CHECK (execution_mode IN ('semi-auto', 'full-auto', 'paper'));

-- Add 'paper' as valid trading_mode for bot_state
ALTER TABLE bot_state DROP CONSTRAINT IF EXISTS bot_state_trading_mode_check;
ALTER TABLE bot_state ADD CONSTRAINT bot_state_trading_mode_check
  CHECK (trading_mode IN ('semi-auto', 'full-auto', 'paper'));
