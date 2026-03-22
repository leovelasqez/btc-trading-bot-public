import { format } from 'date-fns';
import type { TradeFull } from '../lib/types';

interface TradeTableProps {
  trades: TradeFull[];
}

export function TradeTable({ trades }: TradeTableProps) {
  if (trades.length === 0) {
    return <p className="empty-msg">No hay trades registrados</p>;
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Señal</th>
            <th>Confianza</th>
            <th>Entrada</th>
            <th>Salida</th>
            <th>Cantidad</th>
            <th>PnL</th>
            <th>Estado</th>
            <th>Modo</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td>{format(new Date(t.created_at), 'dd/MM HH:mm')}</td>
              <td>
                <span className={`badge badge-${t.side.toLowerCase()}`}>
                  {t.side}
                </span>
              </td>
              <td>{t.confidence}%</td>
              <td>${Number(t.entry_price).toFixed(2)}</td>
              <td>{t.exit_price ? `$${Number(t.exit_price).toFixed(2)}` : '—'}</td>
              <td>{Number(t.quantity).toFixed(5)}</td>
              <td className={pnlClass(t.pnl_usdt)}>
                {t.pnl_usdt !== null ? `$${Number(t.pnl_usdt).toFixed(2)}` : '—'}
              </td>
              <td>
                <span className={`badge badge-${t.status}`}>{t.status}</span>
              </td>
              <td>{t.execution_mode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pnlClass(pnl: number | null): string {
  if (pnl === null) return '';
  return pnl > 0 ? 'pnl-positive' : pnl < 0 ? 'pnl-negative' : '';
}
