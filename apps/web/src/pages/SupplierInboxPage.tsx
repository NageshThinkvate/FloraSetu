import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate } from '../lib/api/fulfilment';
import { InboxItem, rfqInbox } from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

// Supplier requests inbox (Phase 4): attention-first — soonest offer deadline first.
// No internal IDs; cards carry the buyer's request summary and deadline.
export function SupplierInboxPage(): JSX.Element {
  const [items, setItems] = useState<InboxItem[] | null>(null);

  useEffect(() => {
    rfqInbox().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  if (items === null) {
    return <SkeletonLoader variant="card" count={3} testId="inbox-loading" />;
  }
  const ordered = [...items].sort((a, b) =>
    new Date(a.quote_deadline ?? '9999').getTime() - new Date(b.quote_deadline ?? '9999').getTime());

  return (
    <div data-testid="supplier-inbox">
      <PageHeader overline="Requests" title="Buyer requests" testId="inbox-header" />
      {ordered.length === 0 && (
        <EmptyState
          title="No open requests"
          hint="When a buyer's requirement matches your catalog, it lands here with a clear deadline."
          testId="inbox-empty"
        />
      )}
      <div className="fs-md-stack">
        {ordered.map((i) => (
          <TaskCard
            key={i.invitation_id}
            testId={`inbox-${i.ref}`}
            title={i.title}
            meta={[i.quote_deadline ? `Offer due ${fmtDate(i.quote_deadline)}` : 'No deadline']}
            status={i.invitation_status}
            footer={
              <Link className="fs-btn fs-btn--sm" data-testid={`inbox-open-${i.ref}`} to={`/supplier/requests/${i.id}`}>
                {i.invitation_status === 'INVITED' || i.invitation_status === 'VIEWED' ? 'View & quote' : 'Open'}
              </Link>
            }
          />
        ))}
      </div>
    </div>
  );
}
