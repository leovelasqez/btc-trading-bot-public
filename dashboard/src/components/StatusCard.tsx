interface StatusCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
}

export function StatusCard({ title, value, subtitle, color }: StatusCardProps) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-value" style={color ? { color } : undefined}>
        {value}
      </div>
      {subtitle && <div className="card-subtitle">{subtitle}</div>}
    </div>
  );
}
