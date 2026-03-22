import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { AiDecision } from '../lib/types';

interface ConfidenceChartProps {
  decisions: AiDecision[];
}

export function ConfidenceChart({ decisions }: ConfidenceChartProps) {
  if (decisions.length === 0) {
    return <p className="empty-msg">Sin datos de confianza</p>;
  }

  const chartData = decisions.map((d, i) => ({
    index: decisions.length - i,
    confidence: d.confidence,
    signal: d.ai_signal,
    accepted: d.accepted,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <ScatterChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis dataKey="index" tick={{ fill: '#999', fontSize: 12 }} label={{ value: 'Análisis #', fill: '#999', position: 'insideBottom', offset: -5 }} />
        <YAxis domain={[0, 100]} tick={{ fill: '#999', fontSize: 12 }} label={{ value: 'Confianza %', fill: '#999', angle: -90, position: 'insideLeft' }} />
        <Tooltip
          contentStyle={{ background: '#1a1a2e', border: '1px solid #333' }}
        />
        <ReferenceLine y={70} stroke="#ff9800" strokeDasharray="5 5" label={{ value: 'Threshold', fill: '#ff9800' }} />
        <Scatter dataKey="confidence" fill="#64b5f6" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
