import { format } from 'date-fns';
import type { AiDecision } from '../lib/types';

interface DecisionTableProps {
  decisions: AiDecision[];
}

export function DecisionTable({ decisions }: DecisionTableProps) {
  if (decisions.length === 0) {
    return <p className="empty-msg">No hay decisiones registradas</p>;
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Señal</th>
            <th>Confianza</th>
            <th>Entry</th>
            <th>SL</th>
            <th>TP</th>
            <th>Latencia</th>
            <th>Aceptado</th>
            <th>Razón</th>
          </tr>
        </thead>
        <tbody>
          {decisions.map((d) => (
            <tr key={d.id}>
              <td>{format(new Date(d.created_at), 'dd/MM HH:mm')}</td>
              <td>
                <span className={`badge badge-${d.ai_signal.toLowerCase()}`}>
                  {d.ai_signal}
                </span>
              </td>
              <td>{d.confidence}%</td>
              <td>{d.suggested_entry ? `$${Number(d.suggested_entry).toFixed(2)}` : '—'}</td>
              <td>{d.suggested_stop_loss ? `$${Number(d.suggested_stop_loss).toFixed(2)}` : '—'}</td>
              <td>{d.suggested_take_profit ? `$${Number(d.suggested_take_profit).toFixed(2)}` : '—'}</td>
              <td>{d.latency_ms ? `${d.latency_ms}ms` : '—'}</td>
              <td>{d.accepted ? '✅' : '❌'}</td>
              <td>{d.rejection_reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
