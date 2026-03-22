import { useTrades } from '../hooks/useTrades';
import { TradeTable } from '../components/TradeTable';

export function Trades() {
  const { trades, loading } = useTrades(100);

  if (loading) return <div className="loading">Cargando trades...</div>;

  const openTrades = trades.filter((t) => t.status === 'open');
  const closedTrades = trades.filter((t) => t.status !== 'open');

  return (
    <div>
      {openTrades.length > 0 && (
        <section className="section">
          <h2>Posiciones Abiertas ({openTrades.length})</h2>
          <TradeTable trades={openTrades} />
        </section>
      )}

      <section className="section">
        <h2>Historial de Trades ({closedTrades.length})</h2>
        <TradeTable trades={closedTrades} />
      </section>
    </div>
  );
}
