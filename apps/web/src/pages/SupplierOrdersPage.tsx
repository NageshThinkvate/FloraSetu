import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyAllocations, SupplierAllocationSummary } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

// Supplier orders (Phase 4): awarded allocations as cards. Confirm inline; open the
// fulfilment page for packing, logistics handoff and delivery status.
export function SupplierOrdersPage(): JSX.Element {
  const [allocations, setAllocations] = useState<SupplierAllocationSummary[] | null>(null);

  useEffect(() => {
    listMyAllocations().then((r) => setAllocations(r.items)).catch(() => setAllocations([]));
  }, []);

  if (allocations === null) {
    return <SkeletonLoader variant="card" count={3} testId="supplier-orders-loading" />;
  }

  return (
    <div data-testid="supplier-orders-page">
      <PageHeader overline="Orders" title="Orders to fulfil" testId="supplier-orders-header" />
      {allocations.length === 0 && (
        <EmptyState
          title="No orders yet"
          hint="When a buyer confirms your offer, the order lands here for fulfilment."
          actionLabel="View requests"
          onAction={() => { window.location.href = '/supplier/requests'; }}
          testId="supplier-orders-empty"
        />
      )}
      <div className="fs-md-stack">
        {allocations.map((a) => (
          <TaskCard
            key={a.id}
            testId={`alloc-card-${a.ref}`}
            title={`Order ${a.order_ref}`}
            meta={[
              a.delivery_destination ? `deliver to ${a.delivery_destination}` : 'destination open',
              `${a.lines.length} line${a.lines.length === 1 ? '' : 's'}`
            ]}
            status={a.status}
            footer={
              <Link className="fs-btn fs-btn--sm" data-testid={`alloc-open-${a.ref}`} to={`/supplier/orders/${a.order_id}`}>
                {a.status === 'PENDING_CONFIRMATION' ? 'Confirm order' : 'Open fulfilment'}
              </Link>
            }
          />
        ))}
      </div>
    </div>
  );
}
