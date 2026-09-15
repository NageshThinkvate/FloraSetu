interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: 'up' | 'down';
  testId?: string;
}

export function MetricCard({
  label,
  value,
  delta,
  deltaDirection,
  testId = 'metric-card'
}: MetricCardProps): JSX.Element {
  return (
    <div className="fs-card fs-metric" data-testid={testId}>
      <span className="fs-metric__value">{value}</span>
      <span className="fs-metric__label">{label}</span>
      {delta && (
        <span
          className={`fs-metric__delta${deltaDirection ? ` fs-metric__delta--${deltaDirection}` : ''}`}
          data-testid={`${testId}-delta`}
        >
          {delta}
        </span>
      )}
    </div>
  );
}
