interface LogoProps {
  variant?: 'mark' | 'horizontal' | 'wordmark';
  light?: boolean;
  size?: number;
  testId?: string;
}

// Approved botanical bridge mark (corrected geometry): the flower rises from the
// bridge arc's apex — petals never cross or protrude below the arc stroke.
// Palette (owner ruling): bridge + foliage #183D33 (Setu), bloom #76518F (Flora).
const ARC = 'M12 50 A20 20 0 0 1 52 50';
const PETAL_LEFT = 'M32 30 C27 28.5 19 25 15 17 C23.5 18.5 30 23 32 30 Z';
const PETAL_RIGHT = 'M32 30 C37 28.5 45 25 49 17 C40.5 18.5 34 23 32 30 Z';
const BLOOM = 'M32 8 C38.5 15 39.5 23 32 30 C24.5 23 25.5 15 32 8 Z';

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
      <path d={ARC} fill="none" stroke={structure} strokeWidth="6.5" strokeLinecap="round" />
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
