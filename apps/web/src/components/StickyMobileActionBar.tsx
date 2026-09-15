import { ReactNode } from 'react';

interface StickyMobileActionBarProps {
  children: ReactNode;
  testId?: string;
}

export function StickyMobileActionBar({
  children,
  testId = 'sticky-mobile-action-bar'
}: StickyMobileActionBarProps): JSX.Element {
  return (
    <div className="fs-sticky-bar" data-testid={testId}>
      {children}
    </div>
  );
}
