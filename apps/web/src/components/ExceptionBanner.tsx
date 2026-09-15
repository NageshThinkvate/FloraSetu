import { ReactNode } from 'react';
import { OctagonAlert } from 'lucide-react';

interface ExceptionBannerProps {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}

export function ExceptionBanner({
  title,
  children,
  actionLabel,
  onAction,
  testId = 'exception-banner'
}: ExceptionBannerProps): JSX.Element {
  return (
    <div className="fs-exception" data-testid={testId} role="alert">
      <OctagonAlert size={20} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <div className="fs-exception__body">
        <p className="fs-exception__title">{title}</p>
        <p>{children}</p>
      </div>
      {actionLabel && (
        <button className="fs-btn fs-btn--danger fs-btn--sm" data-testid={`${testId}-action`} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
