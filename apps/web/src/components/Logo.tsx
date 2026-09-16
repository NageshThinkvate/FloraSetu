interface LogoProps {
  variant?: 'mark' | 'horizontal' | 'wordmark';
  light?: boolean;
  size?: number;
  testId?: string;
}

// FloraSetu brand mark (brand board, 2026-09): a central plum petal flanked by two
// green side petals, rising ABOVE a detached green bridge arc ("Setu"). The petal
// junction at (32,31) sits just over the arc crown — nothing crosses below the arc.
const ARC = 'M7 54 A25 20 0 0 1 57 54';
const PETAL_LEFT = 'M32 31 C27 30 18 27 13 17 C21 17 29 22 32 31 Z';
const PETAL_RIGHT = 'M32 31 C37 30 46 27 51 17 C43 17 35 22 32 31 Z';
const BLOOM = 'M32 31 C38.5 25 38.5 15 32 7 C25.5 15 25.5 25 32 31 Z';
const GREEN = '#0F3D2E';
const PLUM = '#6F4B8B';
const GREEN_LIGHT = '#F8F8F5';
const PLUM_LIGHT = '#D9C2E3';

function Mark({ light, size }: { light: boolean; size: number }): JSX.Element {
  const structure = light ? GREEN_LIGHT : GREEN;
  const bloom = light ? PLUM_LIGHT : PLUM;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="FloraSetu"
      data-testid="logo-mark-svg"
    >
      <path d={ARC} fill="none" stroke={structure} strokeWidth="7" strokeLinecap="round" />
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
