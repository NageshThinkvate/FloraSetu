import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyQuotes, QuoteSummary, rfqInbox } from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

// My offers (Phase 4): the supplier's submitted quotations with status and validity,
// one tap back to the request for revision.
export function MyQuotesPage(): JSX.Element {
  const [items, setItems] = useState<QuoteSummary[] | null>(null);
  const [rfqIdByRef, setRfqIdByRef] = useState<Record<string, string>>({});

  useEffect(() => {
    listMyQuotes().then((r) => setItems(r.items)).catch(() => setItems([]));
    rfqInbox().then((r) => {
      const map: Record<string, string> = {};
      for (const i of r.items) {
        map[i.ref] = i.id;
      }
      setRfqIdByRef(map);
    }).catch(() => undefined);
  }, []);

  if (items === null) {
    return <SkeletonLoader variant="card" count={2} testId="quotes-loading" />;
  }

  return (
    <div data-testid="my-quotes">
      <PageHeader overline="My offers" title="Offers you have sent" testId="quotes-header" />
      {items.length === 0 && (
        <EmptyState
          title="No offers yet"
          hint="Open a buyer request and send an offer — it appears here with its status."
          actionLabel="View requests"
          onAction={() => { window.location.href = '/supplier/requests'; }}
          testId="quotes-empty"
        />
      )}
      <div className="fs-md-stack">
        {items.map((q) => (
          <TaskCard
            key={q.id}
            testId={`quote-card-${q.ref}`}
            title={q.rfq_title}
            meta={[`version ${q.current_version_no}`, `valid until ${new Date(q.valid_to).toLocaleDateString('en-IN')}`]}
            status={q.version_status}
            footer={rfqIdByRef[q.rfq_ref] ? (
              <Link className="fs-btn fs-btn--sm" data-testid={`quote-open-${q.ref}`} to={`/supplier/requests/${rfqIdByRef[q.rfq_ref]}`}>
                Open request
              </Link>
            ) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
