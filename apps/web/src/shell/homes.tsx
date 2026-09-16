import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';
import { listEvents, listRequirements, EventSummary, RequirementSummary, inr, rfqInbox, InboxItem } from '../lib/api/demand';
import {
  listMyOrders, OrderSummary, fmtDate, listMyAllocations, SupplierAllocationSummary,
  listMyLots, LotSummary, listMySettlements, SettlementRow
} from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { PrimaryActionCard } from '../components/PrimaryActionCard';
import { TaskCard } from '../components/TaskCard';
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

// Supplier home (Phase 4): attention-first — new requests, offers due, orders to fulfil,
// supply needing evidence, dispatches pending, payout status. Primary: view requests, add supply.
export function SupplierHome(): JSX.Element {
  const navigate = useNavigate();
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [allocations, setAllocations] = useState<SupplierAllocationSummary[]>([]);
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);

  useEffect(() => {
    rfqInbox().then((r) => setInbox(r.items)).catch(() => undefined);
    listMyAllocations().then((r) => setAllocations(r.items)).catch(() => undefined);
    listMyLots().then((r) => setLots(r.items)).catch(() => undefined);
    listMySettlements().then((r) => setSettlements(r.items)).catch(() => undefined);
  }, []);

  const newRequests = inbox.filter((i) => ['INVITED', 'VIEWED'].includes(i.invitation_status));
  const offersDue = inbox.filter((i) =>
    !['DECLINED'].includes(i.invitation_status) && i.quote_deadline
    && new Date(i.quote_deadline).getTime() - Date.now() < 48 * 3600 * 1000);
  const ordersToFulfil = allocations.filter((a) =>
    a.status === 'PENDING_CONFIRMATION'
    || a.lines.some((l) => !['PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(l.fulfilment_status)));
  const dispatchesPending = allocations.filter((a) =>
    a.lines.some((l) => l.fulfilment_status === 'PACKED'));
  const needsEvidence = lots.filter((l) => ['STOCK_RECEIVED', 'HARVESTED'].includes(l.status));
  const latestPayout = settlements[0] ?? null;

  return (
    <div data-testid="supplier-home">
      <PageHeader overline="Supplier workspace" title="Good day" testId="supplier-home-header" />
      <div className="fs-md-stack" data-testid="supplier-home-actions">
        <PrimaryActionCard
          title="View requests"
          description={`${newRequests.length} new buyer request${newRequests.length === 1 ? '' : 's'} waiting for your offer.`}
          onAction={() => navigate('/supplier/requests')}
          testId="supplier-action-requests"
        />
        <PrimaryActionCard
          title="Add supply"
          description="Photos first, then flower, quantity and your declaration — two minutes."
          onAction={() => navigate('/supplier/supply/new')}
          testId="supplier-action-supply"
        />
      </div>

      <section style={{ marginTop: 'var(--fs-space-6)' }} data-testid="supplier-attention">
        <p className="fs-overline">Needs attention</p>
        <div className="fs-md-stack">
          {newRequests.length > 0 && (
            <TaskCard testId="supplier-attn-requests" title={`${newRequests.length} new request${newRequests.length === 1 ? '' : 's'}`}
              footer={<Link className="fs-btn fs-btn--sm" data-testid="supplier-attn-requests-open" to="/supplier/requests">View requests</Link>} />
          )}
          {offersDue.length > 0 && (
            <TaskCard testId="supplier-attn-offers-due" title={`${offersDue.length} offer${offersDue.length === 1 ? '' : 's'} due within 48 hours`}
              footer={<Link className="fs-btn fs-btn--sm" data-testid="supplier-attn-offers-open" to="/supplier/requests">Quote now</Link>} />
          )}
          {ordersToFulfil.length > 0 && (
            <TaskCard testId="supplier-attn-orders" title={`${ordersToFulfil.length} order${ordersToFulfil.length === 1 ? '' : 's'} to fulfil`}
              footer={<Link className="fs-btn fs-btn--sm" data-testid="supplier-attn-orders-open" to="/supplier/orders">Open orders</Link>} />
          )}
          {needsEvidence.length > 0 && (
            <TaskCard testId="supplier-attn-evidence" title={`${needsEvidence.length} lot${needsEvidence.length === 1 ? '' : 's'} need photos or declaration`}
              footer={<Link className="fs-btn fs-btn--sm" data-testid="supplier-attn-evidence-open" to="/supplier/supply">Complete evidence</Link>} />
          )}
          {dispatchesPending.length > 0 && (
            <TaskCard testId="supplier-attn-dispatch" title={`${dispatchesPending.length} dispatch${dispatchesPending.length === 1 ? '' : 'es'} pending handoff`}
              footer={<Link className="fs-btn fs-btn--sm" data-testid="supplier-attn-dispatch-open" to="/supplier/orders">View</Link>} />
          )}
          {newRequests.length + offersDue.length + ordersToFulfil.length + needsEvidence.length + dispatchesPending.length === 0 && (
            <TaskCard testId="supplier-attn-clear" title="All clear — nothing needs your attention right now" />
          )}
        </div>
      </section>

      <section style={{ marginTop: 'var(--fs-space-6)' }} data-testid="supplier-payout-status">
        <p className="fs-overline">Payout status</p>
        {latestPayout ? (
          <TaskCard
            testId="supplier-payout-latest"
            title={`${inr(latestPayout.net_minor)} net`}
            meta={[`gross ${inr(latestPayout.gross_minor)}`, latestPayout.payout_ref ? `ref ${latestPayout.payout_ref}` : 'transfer pending']}
            status={latestPayout.status}
            footer={<Link className="fs-btn fs-btn--sm" data-testid="supplier-payout-open" to="/supplier/payments">All payouts</Link>}
          />
        ) : (
          <TaskCard testId="supplier-payout-none" title="No payouts yet"
            meta={['Settled orders appear here with full breakdown']} />
        )}
      </section>
    </div>
  );
}
