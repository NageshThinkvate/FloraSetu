import { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  overline?: string;
  level?: 1 | 2;
  onBack?: () => void;
  actions?: ReactNode;
  testId?: string;
}

export function PageHeader({
  title,
  overline,
  level = 1,
  onBack,
  actions,
  testId = 'page-header'
}: PageHeaderProps): JSX.Element {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <div className="fs-page-header" data-testid={testId}>
      {onBack && (
        <button type="button" className="fs-page-header__back" data-testid={`${testId}-back`} onClick={onBack}>
          <ChevronLeft size={16} aria-hidden="true" /> Back
        </button>
      )}
      {overline && <span className="fs-overline">{overline}</span>}
      <div className="fs-page-header__row">
        <Heading className={`fs-page-header__title ${level === 1 ? 'fs-h1' : 'fs-h2'}`}>{title}</Heading>
        {actions && <div className="fs-page-header__actions">{actions}</div>}
      </div>
    </div>
  );
}
