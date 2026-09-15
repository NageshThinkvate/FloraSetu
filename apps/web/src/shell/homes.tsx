import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, Flower2, PackagePlus, ClipboardList, Banknote } from 'lucide-react';
import { apiGet } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { PrimaryActionCard } from '../components/PrimaryActionCard';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';

interface Feed {
  items: { id: string; type: string; readAt: string | null }[];
  unreadCount: number;
}

const ACTION_LABEL: Record<string, { text: string; to: string }> = {
  'quote.received': { text: 'New offers received', to: '/buyer/offers' },
  'shipment.delivered': { text: 'Delivery waiting for your confirmation', to: '/buyer/orders' },
  'rfq.clarification': { text: 'A supplier asked a question', to: '/buyer/offers' }
};

export function BuyerHome(): JSX.Element {
  const { me } = useAuth();
  const navigate = useNavigate();
  const firstName = me?.display_name.split(' ')[0] ?? 'there';
  const [feed, setFeed] = useState<Feed>({ items: [], unreadCount: 0 });

  useEffect(() => {
    apiGet<Feed>('/notifications')
      .then(setFeed)
      .catch(() => undefined);
  }, []);

  const actions = feed.items.filter((n) => !n.readAt && ACTION_LABEL[n.type]).slice(0, 3);

  return (
    <div data-testid="buyer-home">
      <PageHeader overline="Buyer workspace" title={`Good morning, ${firstName}`} testId="buyer-home-header" />
      <div className="fs-preview__grid" style={{ marginBottom: 'var(--fs-space-6)' }}>
        <PrimaryActionCard
          title="Get flowers"
          description="About a minute — we source offers for you"
          icon={Flower2}
          onAction={() => navigate('/buyer/requests/new')}
          testId="buyer-home-get-flowers"
        />
        <PrimaryActionCard
          title="Plan an event"
          description="Ceremonies and flower lists"
          icon={CalendarDays}
          onAction={() => navigate('/buyer/events')}
          testId="buyer-home-plan-event"
        />
      </div>
      <p className="fs-overline" data-testid="buyer-home-action-label">Action needed</p>
      {actions.length === 0 ? (
        <EmptyState
          title="Nothing needs your attention"
          hint="New offers, deliveries and questions will show up here."
          actionLabel="Get flowers"
          onAction={() => navigate('/buyer/requests/new')}
          testId="buyer-home-action-empty"
        />
      ) : (
        <div className="fs-md-stack" data-testid="buyer-home-action-list">
          {actions.map((n) => (
            <TaskCard
              key={n.id}
              title={ACTION_LABEL[n.type].text}
              age="Unread"
              actionLabel="Open"
              onAction={() => undefined}
              footer={
                <Link to={ACTION_LABEL[n.type].to} data-testid={`buyer-action-${n.id.slice(0, 8)}`} className="fs-btn fs-btn--sm">
                  Open
                </Link>
              }
              testId={`buyer-action-card-${n.id.slice(0, 8)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SupplierHome(): JSX.Element {
  const { me } = useAuth();
  const navigate = useNavigate();
  const firstName = me?.display_name.split(' ')[0] ?? 'there';
  return (
    <div data-testid="supplier-home">
      <PageHeader overline="Supplier workspace" title={`What needs your attention, ${firstName}?`} testId="supplier-home-header" />
      <div className="fs-preview__grid" style={{ marginBottom: 'var(--fs-space-6)' }}>
        <PrimaryActionCard
          title="View requests"
          description="New buyer demand matched to you"
          icon={ClipboardList}
          onAction={() => navigate('/supplier/requests')}
          testId="supplier-home-requests"
        />
        <PrimaryActionCard
          title="Add supply"
          description="Camera-first lot intake"
          icon={PackagePlus}
          onAction={() => navigate('/supplier/supply')}
          testId="supplier-home-add-supply"
        />
        <PrimaryActionCard
          title="Payouts"
          description="Gross, deductions, net and payout status"
          icon={Banknote}
          onAction={() => navigate('/supplier/payments')}
          testId="supplier-home-payments"
        />
      </div>
      <p className="fs-overline">Today</p>
      <EmptyState
        title="Your work queues live here"
        hint="New requests, quotes due, orders to fulfil, lots awaiting quality checks and payout status will appear as cards."
        actionLabel="View requests"
        onAction={() => navigate('/supplier/requests')}
        testId="supplier-home-queues"
      />
    </div>
  );
}
