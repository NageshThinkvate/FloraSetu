import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listMyRfqs, RfqSummary } from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

// Buyer offers inbox (Phase 3 §3): one card per sourcing round — offers count, deadline,
// buyer-controlled comparison one tap away. No ranking, no "best" labels.
export function RfqsPage(): JSX.Element {
  const navigate = useNavigate();
  const [rfqs, setRfqs] = useState<RfqSummary[] | null>(null);

  useEffect(() => {
    listMyRfqs().then((r) => setRfqs(r.items)).catch(() => setRfqs([]));
  }, []);

  if (rfqs === null) {
    return <SkeletonLoader variant="card" count={3} testId="offers-loading" />;
  }

  const withQuotes = rfqs.filter((r) => (r.quotes ?? 0) > 0);
  const without = rfqs.filter((r) => (r.quotes ?? 0) === 0);
  const ordered = [...withQuotes, ...without];

  return (
    <div data-testid="offers-page">
      <PageHeader overline="Offers" title="Your offers" testId="offers-header" />
      {ordered.length === 0 && (
        <EmptyState
          title="No sourcing rounds yet"
          hint="Send a flower request and suitable suppliers will respond with offers."
          actionLabel="Get flowers"
          onAction={() => navigate('/buyer/requests/new')}
          testId="offers-empty"
        />
      )}
      <div className="fs-md-stack">
        {ordered.map((r) => {
          const quotes = r.quotes ?? 0;
          return (
            <TaskCard
              key={r.id}
              testId={`offer-round-${r.ref}`}
              title={r.title ?? r.ref}
              meta={[
                quotes > 0 ? `${quotes} offer${quotes === 1 ? '' : 's'} received` : 'Waiting for offers',
                r.quote_deadline ? `closes ${new Date(r.quote_deadline).toLocaleDateString('en-IN')}` : 'open'
              ]}
              status={r.status}
              footer={
                <Link className="fs-btn fs-btn--sm" data-testid={`offer-round-open-${r.ref}`} to={`/buyer/offers/${r.id}`}>
                  {quotes > 0 ? 'Compare offers' : 'View'}
                </Link>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
