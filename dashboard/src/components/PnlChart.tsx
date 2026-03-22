import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { DailyStats } from '../lib/types';

interface PnlChartProps {
  stats: DailyStats[];
}

export function PnlChart({ stats }: PnlChartProps) {
  if (stats.length === 0) {
    return <p className="empty-msg">Sin datos de PnL</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={stats}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis dataKey="trade_date" tick={{ fill: '#999', fontSize: 12 }} />
        <YAxis tick={{ fill: '#999', fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: '#1a1a2e', border: '1px solid #333' }}
          labelStyle={{ color: '#ccc' }}
        />
        <ReferenceLine y={0} stroke="#555" />
        <Bar dataKey="total_pnl" name="PnL ($)">
          {stats.map((entry, i) => (
            <Cell
              key={i}
              fill={Number(entry.total_pnl) >= 0 ? '#00c853' : '#ff1744'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
