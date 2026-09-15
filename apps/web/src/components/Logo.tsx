interface LogoProps {
  variant?: 'mark' | 'horizontal' | 'wordmark';
  light?: boolean;
  size?: number;
  testId?: string;
}

// Vector recreation of the approved botanical bridge brand mark
// (docs/UI_UX_OWNER_RULINGS palette: primary green + restrained plum accent).
function Mark({ light, size }: { light: boolean; size: number }): JSX.Element {
  const leaf = light ? 'var(--fs-bg)' : 'var(--fs-primary)';
  const bud = light ? 'var(--fs-accent-tint)' : 'var(--fs-accent)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="FloraSetu"
      data-testid="logo-mark-svg"
    >
      <path d="M12 50 A20 20 0 0 1 52 50" fill="none" stroke={leaf} strokeWidth="6.5" strokeLinecap="round" />
      <path d="M32 44 C24 40 16 34 13 24 C22 27 29 33 32 44 Z" fill={leaf} />
      <path d="M32 44 C40 40 48 34 51 24 C42 27 35 33 32 44 Z" fill={leaf} />
      <path d="M32 6 C39 15 41 26 32 38 C23 26 25 15 32 6 Z" fill={bud} />
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
      <span className="fs-logo__wordmark">FloraSetu</span>
    </span>
  );
}
