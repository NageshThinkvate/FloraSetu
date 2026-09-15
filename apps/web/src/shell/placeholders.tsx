import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';

interface PlaceholderPageProps {
  overline: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  testId: string;
}

export function PlaceholderPage({
  overline,
  title,
  description,
  actionLabel,
  actionTo,
  testId
}: PlaceholderPageProps): JSX.Element {
  return (
    <div data-testid={testId}>
      <PageHeader overline={overline} title={title} testId={`${testId}-header`} />
      <EmptyState
        title={title}
        hint={description}
        actionLabel={actionLabel}
        onAction={() => undefined}
        testId={`${testId}-empty`}
      />
      {actionTo && actionLabel && (
        <div style={{ marginTop: 'var(--fs-space-3)' }}>
          <Link to={actionTo} className="fs-btn" data-testid={`${testId}-action`}>
            {actionLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
