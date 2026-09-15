import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';
import { useMediaQuery } from '../design/useMediaQuery';
import { MOBILE_MAX_QUERY } from '../design/breakpoints';
import { Drawer } from '../components/Drawer';
import { SideSheet } from '../components/SideSheet';
import { EmptyState } from '../components/EmptyState';

interface NotificationItem {
  id: string;
  type: string;
  readAt: string | null;
  createdAt: string;
  rfqId?: string;
  orderId?: string;
  lotId?: string;
  shipmentId?: string;
  inspectionId?: string;
  quotationId?: string;
}

interface Feed {
  items: NotificationItem[];
  unreadCount: number;
}

// Actionable presentation per notification type (B2) — no generic "you have a notification".
const TYPE_MAP: Record<string, { title: string; cta: string; href: (n: NotificationItem) => string }> = {
  'quote.received': { title: 'New offer received for your request', cta: 'Compare offers', href: (n) => `/buyer/offers/${n.rfqId ?? ''}` },
  'quote.revised': { title: 'An offer on your request was revised', cta: 'View offers', href: () => '/buyer/offers' },
  'award.received': { title: 'Your offer was selected', cta: 'View order', href: () => '/supplier/orders' },
  'order.allocated': { title: 'New order — confirm you can fulfil', cta: 'View order', href: () => '/supplier/orders' },
  'shipment.delivered': { title: 'Delivery waiting for your confirmation', cta: 'Review delivery', href: (n) => `/buyer/orders/${n.orderId ?? ''}` },
  'inspection.completed': { title: 'Quality check completed on your lot', cta: 'View lot', href: (n) => `/supplier/supply/${n.lotId ?? ''}` },
  'rfq.clarification': { title: 'A supplier asked a question on your request', cta: 'Answer', href: (n) => `/buyer/offers/${n.rfqId ?? ''}` },
  'rfq.clarification.answered': { title: 'Your question was answered', cta: 'View request', href: () => '/supplier/requests' }
};

function ageOf(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

export function NotificationBell(): JSX.Element {
  const { activeOrgId } = useAuth();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(MOBILE_MAX_QUERY);
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<Feed>({ items: [], unreadCount: 0 });

  const load = useCallback((): void => {
    if (!activeOrgId) {
      setFeed({ items: [], unreadCount: 0 });
      return;
    }
    apiGet<Feed>('/notifications')
      .then(setFeed)
      .catch(() => setFeed({ items: [], unreadCount: 0 }));
  }, [activeOrgId]);

  // Org switch re-scopes the feed — another organization's notifications never leak.
  useEffect(load, [load]);

  const openItem = (n: NotificationItem): void => {
    void apiPost(`/notifications/${n.id}/read`).catch(() => undefined);
    setOpen(false);
    const mapped = TYPE_MAP[n.type];
    navigate(mapped ? mapped.href(n) : '/');
    window.setTimeout(load, 400);
  };

  const list = (
    <div className="fs-notif" data-testid="notification-feed">
      {feed.items.length === 0 && (
        <EmptyState
          icon={Bell}
          title="Nothing needs your attention"
          hint="Offers, deliveries and quality checks will appear here."
          testId="notification-empty"
        />
      )}
      {feed.items.map((n) => {
        const mapped = TYPE_MAP[n.type] ?? { title: n.type, cta: 'Open', href: () => '/' };
        return (
          <div key={n.id} className={`fs-notif__item${n.readAt ? '' : ' fs-notif__item--unread'}`} data-testid={`notification-item-${n.id.slice(0, 8)}`}>
            <div>
              <p className="fs-notif__title">{mapped.title}</p>
              <p className="fs-notif__age">{ageOf(n.createdAt)}</p>
            </div>
            <button className="fs-btn fs-btn--sm" data-testid={`notification-cta-${n.id.slice(0, 8)}`} onClick={() => openItem(n)}>
              {mapped.cta}
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="fs-bell"
        data-testid="notification-bell"
        aria-label={`Notifications${feed.unreadCount > 0 ? `, ${feed.unreadCount} unread` : ''}`}
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        <Bell size={20} aria-hidden="true" />
        {feed.unreadCount > 0 && (
          <span className="fs-bell__badge" data-testid="notification-badge">
            {feed.unreadCount}
          </span>
        )}
      </button>
      {isMobile ? (
        <Drawer open={open} title="Notifications" onClose={() => setOpen(false)} testId="notification-drawer">
          {list}
        </Drawer>
      ) : (
        <SideSheet open={open} title="Notifications" onClose={() => setOpen(false)} testId="notification-sheet">
          {list}
        </SideSheet>
      )}
    </>
  );
}
