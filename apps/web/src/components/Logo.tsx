interface LogoProps {
  variant?: 'mark' | 'horizontal' | 'wordmark';
  light?: boolean;
  size?: number;
  testId?: string;
}

// Canonical FloraSetu mark (final approved geometry): a restrained flower — central plum
// petal with two botanical side petals — rising from the crown of a broad botanical-green
// bridge arc ("Setu"). All three petal paths terminate at the crown junction (y=34);
// nothing crosses or protrudes below the bridge. One geometry for every size/variant.
const ARC = 'M8 52 A28 18 0 0 1 56 52';
const PETAL_LEFT = 'M32 34 C27 32 20 28 17 20 C25 21 31 27 32 34 Z';
const PETAL_RIGHT = 'M32 34 C37 32 44 28 47 20 C39 21 33 27 32 34 Z';
const BLOOM = 'M32 34 C39 27 40 17 32 10 C24 17 25 27 32 34 Z';

function Mark({ light, size }: { light: boolean; size: number }): JSX.Element {
  const structure = light ? 'var(--fs-bg)' : 'var(--fs-primary)';
  const bloom = light ? 'var(--fs-accent-tint)' : 'var(--fs-accent)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="FloraSetu"
      data-testid="logo-mark-svg"
    >
      <path d={ARC} fill="none" stroke={structure} strokeWidth="6" strokeLinecap="round" />
      <path d={PETAL_LEFT} fill={structure} />
      <path d={PETAL_RIGHT} fill={structure} />
      <path d={BLOOM} fill={bloom} />
    </svg>
  );
}

export function Logo({
  variant = 'horizontal',
  light = false,
  size = 30,
  testId = 'logo'
}: LogoProps): JSX.Element {
  if (variant === 'mark') {
    return (
      <span className="fs-logo" data-testid={testId}>
        <Mark light={light} size={size} />
      </span>
    );
  }
  return (
    <span className={`fs-logo${light ? ' fs-logo--light' : ''}`} data-testid={testId}>
      {variant === 'horizontal' && <Mark light={light} size={size} />}
      <span className="fs-logo__wordmark">
        <span className="fs-logo__flora">Flora</span>
        <span className="fs-logo__setu">Setu</span>
      </span>
    </span>
  );
}
