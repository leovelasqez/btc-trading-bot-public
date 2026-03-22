import { useAiDecisions } from '../hooks/useAiDecisions';
import { DecisionTable } from '../components/DecisionTable';

export function Decisions() {
  const { decisions, loading } = useAiDecisions(100);

  if (loading) return <div className="loading">Cargando decisiones...</div>;

  const accepted = decisions.filter((d) => d.accepted).length;
  const rejected = decisions.length - accepted;

  return (
    <div>
      <div className="cards-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-title">Total Decisiones</div>
          <div className="card-value">{decisions.length}</div>
        </div>
        <div className="card">
          <div className="card-title">Aceptadas</div>
          <div className="card-value" style={{ color: '#00c853' }}>{accepted}</div>
        </div>
        <div className="card">
          <div className="card-title">Rechazadas</div>
          <div className="card-value" style={{ color: '#ff9800' }}>{rejected}</div>
        </div>
        <div className="card">
          <div className="card-title">Tasa de Aceptacion</div>
          <div className="card-value">
            {decisions.length > 0 ? ((accepted / decisions.length) * 100).toFixed(1) : 0}%
          </div>
        </div>
      </div>

      <section className="section">
        <h2>Decisiones de Gemini AI</h2>
        <DecisionTable decisions={decisions} />
      </section>
    </div>
  );
}
