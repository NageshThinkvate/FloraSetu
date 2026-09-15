import { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

const VARIANT_ICONS: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle
};

interface InlineAlertProps {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
  testId?: string;
}

export function InlineAlert({
  variant,
  title,
  children,
  testId = 'inline-alert'
}: InlineAlertProps): JSX.Element {
  const Icon = VARIANT_ICONS[variant];
  return (
    <div
      className={`fs-alert fs-alert--${variant}`}
      data-testid={testId}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <Icon size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        {title && <p className="fs-alert__title">{title}</p>}
        <p>{children}</p>
      </div>
    </div>
  );
}
