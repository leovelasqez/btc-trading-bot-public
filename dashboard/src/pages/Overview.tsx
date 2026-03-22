import { useBotState } from '../hooks/useBotState';
import { useTrades } from '../hooks/useTrades';
import { useDailyStats } from '../hooks/useDailyStats';
import { useAiDecisions } from '../hooks/useAiDecisions';
import { StatusCard } from '../components/StatusCard';
import { PnlChart } from '../components/PnlChart';
import { ConfidenceChart } from '../components/ConfidenceChart';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function Overview() {
  const { state, loading: stateLoading } = useBotState();
  const { trades } = useTrades(10);
  const { stats } = useDailyStats(30);
  const { decisions } = useAiDecisions(50);

  if (stateLoading) return <div className="loading">Cargando...</div>;
  if (!state) return <div className="loading">Sin datos del bot</div>;

  const openTrades = trades.filter((t) => t.status === 'open');
  const lastAnalysis = state.last_analysis_at
    ? formatDistanceToNow(new Date(state.last_analysis_at), { addSuffix: true, locale: es })
    : 'Nunca';

  const winRate =
    state.daily_trades > 0
      ? ((state.daily_wins / state.daily_trades) * 100).toFixed(1)
      : '0';

  return (
    <div>
      <div className="cards-grid">
        <StatusCard
          title="Estado"
          value={state.is_paused ? 'PAUSADO' : 'ACTIVO'}
          subtitle={state.pause_reason ?? undefined}
          color={state.is_paused ? '#ff9800' : '#00c853'}
        />
        <StatusCard
          title="Balance"
          value={state.current_balance ? `$${Number(state.current_balance).toFixed(2)}` : '—'}
          subtitle={`Inicio del dia: $${state.start_of_day_balance ? Number(state.start_of_day_balance).toFixed(2) : '—'}`}
        />
        <StatusCard
          title="PnL Diario"
          value={`$${Number(state.daily_pnl).toFixed(2)}`}
          color={Number(state.daily_pnl) >= 0 ? '#00c853' : '#ff1744'}
        />
        <StatusCard
          title="Trades Hoy"
          value={state.daily_trades}
          subtitle={`W: ${state.daily_wins} / L: ${state.daily_losses} (${winRate}%)`}
        />
        <StatusCard
          title="Posiciones Abiertas"
          value={openTrades.length}
          color={openTrades.length > 0 ? '#64b5f6' : undefined}
        />
        <StatusCard
          title="Ultimo Analisis"
          value={lastAnalysis}
          subtitle={`Modo: ${state.trading_mode}`}
        />
      </div>

      <section className="section">
        <h2>PnL Diario (ultimos 30 dias)</h2>
        <PnlChart stats={stats} />
      </section>

      <section className="section">
        <h2>Confianza de Gemini (ultimas 50 decisiones)</h2>
        <ConfidenceChart decisions={decisions} />
      </section>

      {state.last_error && (
        <section className="section error-banner">
          <h3>Ultimo Error</h3>
          <p>{state.last_error}</p>
          <small>
            {state.last_error_at
              ? formatDistanceToNow(new Date(state.last_error_at), { addSuffix: true, locale: es })
              : ''}
          </small>
        </section>
      )}
    </div>
  );
}
