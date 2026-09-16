import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import { fmtDate, listMyOrders, OrderSummary } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

// Buyer orders + deliveries lists (Phase 3 §1/§6): card-based, mobile-first, no tables,
// no internal IDs beyond the friendly reference.
const DELIVERY_STATUSES = ['READY_FOR_DISPATCH', 'IN_TRANSIT', 'DELIVERED', 'ACCEPTANCE_PENDING'];

export function OrdersPage({ deliveriesOnly = false }: { deliveriesOnly?: boolean }): JSX.Element {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);

  useEffect(() => {
    listMyOrders().then((r) => setOrders(r.items)).catch(() => setOrders([]));
  }, []);

  if (orders === null) {
    return <SkeletonLoader variant="card" count={3} testId="orders-loading" />;
  }
  const shown = deliveriesOnly ? orders.filter((o) => DELIVERY_STATUSES.includes(o.status)) : orders;

  return (
    <div data-testid={deliveriesOnly ? 'deliveries-page' : 'orders-page'}>
      <PageHeader
        overline={deliveriesOnly ? 'Deliveries' : 'Orders'}
        title={deliveriesOnly ? 'Deliveries' : 'Your orders'}
        testId="orders-header"
      />
      {shown.length === 0 && (
        <EmptyState
          title={deliveriesOnly ? 'No deliveries on the way' : 'No orders yet'}
          hint={deliveriesOnly
            ? 'Orders in transit or awaiting your confirmation will appear here.'
            : 'Once you confirm an offer, your order and its delivery journey appear here.'}
          actionLabel="Get flowers"
          onAction={() => navigate('/buyer/requests/new')}
          testId="orders-empty"
        />
      )}
      <div className="fs-md-stack">
        {shown.map((o) => (
          <TaskCard
            key={o.id}
            testId={`order-card-${o.ref}`}
            title={o.ref}
            meta={[
              o.delivery_destination ?? 'Delivery pending',
              inr(o.total_minor ?? 0),
              `${o.lines} line${o.lines === 1 ? '' : 's'} · ${o.suppliers} supplier${o.suppliers === 1 ? '' : 's'}`
            ]}
            status={o.status}
            age={fmtDate(o.created_at)}
            footer={
              <Link className="fs-btn fs-btn--sm" data-testid={`order-open-${o.ref}`} to={`/buyer/orders/${o.id}`}>
                {['DELIVERED', 'ACCEPTANCE_PENDING'].includes(o.status) ? 'Review delivery' : 'Track order'}
              </Link>
            }
          />
        ))}
      </div>
    </div>
  );
}
