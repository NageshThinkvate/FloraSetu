interface SkeletonLoaderProps {
  variant?: 'card' | 'row' | 'text';
  count?: number;
  testId?: string;
}

export function SkeletonLoader({
  variant = 'row',
  count = 3,
  testId = 'skeleton-loader'
}: SkeletonLoaderProps): JSX.Element {
  return (
    <div
      className="fs-md-stack"
      data-testid={testId}
      role="status"
      aria-label="Loading"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`fs-skeleton fs-skeleton--${variant}`} />
      ))}
      <span className="fs-caption" style={{ position: 'absolute', left: '-9999px' }}>
        Loading…
      </span>
    </div>
  );
}
