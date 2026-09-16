import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';
import { inr, listEvents, listRequirements, EventSummary, RequirementSummary } from '../lib/api/demand';
import { listMyOrders, OrderSummary, fmtDate } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { PrimaryActionCard } from '../components/PrimaryActionCard';
import { TaskCard } from '../components/TaskCard';
import { StatusPill } from '../components/StatusPill';
import { EmptyState } from '../components/EmptyState';

interface Feed { items: { id: string; type: string; title: string; body: string; createdAt: string; readAt: string | null }[] }

// Buyer home (Phase 3 §1): what needs my attention + what can I do next.
const ACTION_LABEL: Record<string, string> = {
  'quote.received': 'offer received',
  'clarification.asked': 'supplier question',
  'clarification.answered': 'clarification answered',
  'shipment.delivered': 'delivery arrived',
  'delivery.acceptance_due': 'delivery awaiting confirmation',
  'claim.opened': 'issue update'
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) {
    return 'Good morning';
  }
  if (h < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

export function BuyerHome(): JSX.Element {
  const { me } = useAuth();
  const navigate = useNavigate();
  const firstName = me?.display_name?.split(' ')[0] ?? '';
  const [feed, setFeed] = useState<Feed['items']>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);

  useEffect(() => {
    apiGet<{ items: Feed['items'] }>('/notifications').then((r) => setFeed(r.items)).catch(() => undefined);
    listMyOrders().then((r) => setOrders(r.items)).catch(() => undefined);
    listRequirements().then((r) => setRequirements(r.items)).catch(() => undefined);
    listEvents().then((r) => setEvents(r.items)).catch(() => undefined);
  }, []);

  const actionCounts = new Map<string, number>();
  for (const n of feed) {
    if (!n.readAt && ACTION_LABEL[n.type]) {
      actionCounts.set(n.type, (actionCounts.get(n.type) ?? 0) + 1);
    }
  }
  const deliveredPending = orders.filter((o) => ['DELIVERED', 'ACCEPTANCE_PENDING'].includes(o.status)).length;

  return (
    <div data-testid="buyer-home">
      <PageHeader overline="Buyer workspace" title={`${greeting()}, ${firstName}`} testId="buyer-home-header" />

      <div className="fs-md-stack" data-testid="buyer-home-actions">
        <PrimaryActionCard
          title="Get flowers"
          description="Tell us what you need — quantity, date, delivery location — in about a minute."
          onAction={() => navigate('/buyer/requests/new')}
          testId="buyer-action-flowers"
        />
        <PrimaryActionCard
          title="Plan an event"
          description="Ceremonies, delivery milestones and flower lists — sourcing organized for you."
          onAction={() => navigate('/buyer/events')}
          testId="buyer-action-event"
        />
      </div>

      {(actionCounts.size > 0 || deliveredPending > 0) && (
        <section style={{ marginTop: 'var(--fs-space-6)' }} data-testid="buyer-action-needed">
          <p className="fs-overline">Action needed</p>
          <div className="fs-md-stack">
            {[...actionCounts.entries()].map(([type, count]) => (
              <TaskCard
                key={type}
                testId={`buyer-attn-${type}`}
                title={`${count} ${ACTION_LABEL[type]}${count === 1 ? '' : type === 'clarification.asked' ? 's' : ''}`}
                actionLabel={type === 'quote.received' ? 'View offers' : 'Open'}
                onAction={() => undefined}
                footer={
                  <Link
                    className="fs-btn fs-btn--sm"
                    data-testid={`buyer-attn-open-${type}`}
                    to={type === 'quote.received' ? '/buyer/offers' : type.startsWith('shipment') || type === 'delivery.acceptance_due' ? '/buyer/deliveries' : '/buyer/issues'}
                  >
                    {type === 'quote.received' ? 'View offers' : 'Open'}
                  </Link>
                }
              />
            ))}
            {deliveredPending > 0 && (
              <TaskCard
                testId="buyer-attn-delivery"
                title={`${deliveredPending} deliver${deliveredPending === 1 ? 'y awaiting your confirmation' : 'ies awaiting your confirmation'}`}
                footer={<Link className="fs-btn fs-btn--sm" data-testid="buyer-attn-delivery-open" to="/buyer/deliveries">Review delivery</Link>}
              />
            )}
          </div>
        </section>
      )}

      <section style={{ marginTop: 'var(--fs-space-6)' }} data-testid="buyer-recent-orders">
        <p className="fs-overline">Recent orders</p>
        {orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            hint="Once you confirm an offer, your order and its delivery journey appear here."
            actionLabel="Get flowers"
            onAction={() => navigate('/buyer/requests/new')}
            testId="buyer-orders-empty"
          />
        ) : (
          <div className="fs-md-stack">
            {orders.slice(0, 3).map((o) => (
              <TaskCard
                key={o.id}
                testId={`buyer-order-${o.ref}`}
                title={o.ref}
                meta={[
                  o.delivery_destination ?? 'Delivery pending',
                  inr(o.total_minor ?? 0),
                  `${o.suppliers} supplier${o.suppliers === 1 ? '' : 's'}`
                ]}
                status={o.status}
                age={fmtDate(o.created_at)}
                footer={<Link className="fs-btn fs-btn--sm" data-testid={`buyer-order-open-${o.ref}`} to={`/buyer/orders/${o.id}`}>Open</Link>}
              />
            ))}
          </div>
        )}
      </section>

      {requirements.length > 0 && (
        <section style={{ marginTop: 'var(--fs-space-6)' }} data-testid="buyer-buy-again">
          <p className="fs-overline">Buy again</p>
          <div className="fs-md-stack">
            {requirements.slice(0, 3).map((r) => (
              <TaskCard
                key={r.id}
                testId={`buyer-again-${r.ref}`}
                title={r.title}
                meta={[`${r.line_count} flower${r.line_count === 1 ? '' : 's'}`]}
                age={fmtDate(r.created_at)}
                footer={
                  <Link className="fs-btn fs-btn--sm" data-testid={`buyer-again-open-${r.ref}`} to={`/buyer/requests/new?copy=${r.id}`}>
                    Buy again
                  </Link>
                }
              />
            ))}
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section style={{ marginTop: 'var(--fs-space-6)' }} data-testid="buyer-recent-events">
          <p className="fs-overline">Recent events</p>
          <div className="fs-md-stack">
            {events.slice(0, 3).map((e) => (
              <TaskCard
                key={e.id}
                testId={`buyer-event-${e.id.slice(0, 8)}`}
                title={e.name}
                meta={[`${fmtDate(e.starts_at)} → ${fmtDate(e.ends_at)}`, e.event_type.toLowerCase()]}
                status={e.status}
                footer={<Link className="fs-btn fs-btn--sm" data-testid={`buyer-event-open-${e.id.slice(0, 8)}`} to={`/buyer/events/${e.id}`}>Open</Link>}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// Supplier home (Phase 2) — untouched by Phase 3.
export function SupplierHome(): JSX.Element {
  const navigate = useNavigate();
  const [feed, setFeed] = useState<Feed['items']>([]);
  useEffect(() => {
    apiGet<{ items: Feed['items'] }>('/notifications').then((r) => setFeed(r.items)).catch(() => undefined);
  }, []);
  return (
    <div data-testid="supplier-home">
      <PageHeader overline="Supplier workspace" title="Good day" testId="supplier-home-header" />
      <div className="fs-md-stack" data-testid="supplier-home-queues">
        <PrimaryActionCard
          title="New requirements"
          description="Structured buyer requirements waiting for your offer."
          onAction={() => navigate('/supplier/inbox')}
          testId="supplier-action-inbox"
        />
        <PrimaryActionCard
          title="Add supply"
          description="Record a harvest or stock lot, add photos and declare it."
          onAction={() => navigate('/supplier/supply')}
          testId="supplier-action-supply"
        />
        <PrimaryActionCard
          title="Orders to fulfil"
          description="Confirmed orders, packing and dispatch readiness."
          onAction={() => navigate('/supplier/orders')}
          testId="supplier-action-orders"
        />
        {feed.length > 0 && (
          <StatusPill status="QUOTED" label={`${feed.length} notification${feed.length === 1 ? '' : 's'}`} testId="supplier-home-feed" />
        )}
      </div>
    </div>
  );
}
