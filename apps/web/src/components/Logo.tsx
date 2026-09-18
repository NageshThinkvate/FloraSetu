import lockup from '../assets/florasetu-primary.png';

interface LogoProps {
  variant?: 'mark' | 'horizontal' | 'wordmark';
  light?: boolean;
  size?: number;
  testId?: string;
}

// FloraSetu approved lockup (brand board, 2026-09): bloom-and-bridge mark + custom serif
// lettering + B2B descriptor, used exactly as approved. The mark is the same asset cropped
// from the lockup (proportions from the design system: -22.2%/-30.4%, 474.1% x 163.7%).
const INVERSE: React.CSSProperties = { filter: 'brightness(0) invert(1)' };

function Mark({ light, size }: { light: boolean; size: number }): JSX.Element {
  return (
    <span
      role="img"
      aria-label="FloraSetu"
      data-testid="logo-mark-svg"
      style={{ position: 'relative', display: 'inline-block', width: size, height: size, overflow: 'hidden', flexShrink: 0 }}
    >
      <img
        src={lockup}
        alt=""
        aria-hidden
        style={{
          position: 'absolute', left: '-22.2%', top: '-30.4%', width: '474.1%', height: '163.7%',
          maxWidth: 'none', pointerEvents: 'none', userSelect: 'none', ...(light ? INVERSE : {})
        }}
      />
    </span>
  );
}

function Wordmark({ light, size }: { light: boolean; size: number }): JSX.Element {
  return (
    <span
      role="img"
      aria-label="FloraSetu"
      style={{ position: 'relative', display: 'inline-block', height: size, aspectRatio: '1425 / 640', overflow: 'hidden', flexShrink: 0 }}
    >
      <img
        src={lockup}
        alt="FloraSetu — B2B Flower Commerce Platform"
        style={{
          position: 'absolute', left: '-34.7%', top: 0, height: '100%', width: 'auto',
          maxWidth: 'none', pointerEvents: 'none', userSelect: 'none', ...(light ? INVERSE : {})
        }}
      />
    </span>
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
  if (variant === 'wordmark') {
    return (
      <span className={`fs-logo${light ? ' fs-logo--light' : ''}`} data-testid={testId}>
        <Wordmark light={light} size={size * 1.5} />
      </span>
    );
  }
  return (
    <span className={`fs-logo${light ? ' fs-logo--light' : ''}`} data-testid={testId}>
      <img
        className="fs-logo__lockup"
        src={lockup}
        alt="FloraSetu — B2B Flower Commerce Platform"
        width={1920}
        height={640}
        style={{ ['--fs-logo-h' as string]: `${size}px`, ...(light ? INVERSE : {}) }}
      />
    </span>
  );
}
