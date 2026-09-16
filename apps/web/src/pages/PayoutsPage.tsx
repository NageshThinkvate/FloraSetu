import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMySettlements, SettlementRow, fmtDate } from '../lib/api/fulfilment';
import { inr } from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

// Payouts (Phase 4): gross → adjustments → claim adjustment → net, with payout status
// and UTR/reference. Card-based on mobile; no internal IDs.
export function PayoutsPage(): JSX.Element {
  const [items, setItems] = useState<SettlementRow[] | null>(null);

  useEffect(() => {
    listMySettlements().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  if (items === null) {
    return <SkeletonLoader variant="card" count={2} testId="payouts-loading" />;
  }

  return (
    <div data-testid="payouts-page">
      <PageHeader overline="Payouts" title="Your payouts" testId="payouts-header" />
      {items.length === 0 && (
        <EmptyState
          title="No payouts yet"
          hint="Once a delivered order is settled, the breakdown — gross, adjustments, net and transfer reference — appears here."
          testId="payouts-empty"
        />
      )}
      <div className="fs-md-stack">
        {items.map((s) => {
          const deductions = s.deductions ?? [];
          const claimAdj = Number(s.claim_adjustment_minor ?? 0);
          return (
            <article key={s.id} className="fs-card fs-md-card" data-testid={`payout-${s.ref}`}>
              <div className="fs-task-card__top">
                <span className="fs-md-card__primary">{inr(s.net_minor)} net</span>
                <StatusPill status={s.status} testId={`payout-status-${s.ref}`} />
              </div>
              <div className="fs-md-card__fields">
                <div><div className="fs-md-card__field-label">Gross</div>
                  <div className="fs-md-card__field-value">{inr(s.gross_minor)}</div></div>
                <div><div className="fs-md-card__field-label">Adjustments</div>
                  <div className="fs-md-card__field-value" data-testid={`payout-adj-${s.ref}`}>
                    {deductions.length === 0 ? '—' : deductions.map((d) => `${d.label} −${inr(d.amountMinor)}`).join(' · ')}
                  </div></div>
                <div><div className="fs-md-card__field-label">Claim adjustment</div>
                  <div className="fs-md-card__field-value" data-testid={`payout-claim-${s.ref}`}>
                    {claimAdj ? `−${inr(claimAdj)}` : '—'}
                  </div></div>
                <div><div className="fs-md-card__field-label">UTR / reference</div>
                  <div className="fs-md-card__field-value" data-testid={`payout-utr-${s.ref}`}>{s.payout_ref ?? 'Pending'}</div></div>
                {s.payout_date && (
                  <div><div className="fs-md-card__field-label">Paid on</div>
                    <div className="fs-md-card__field-value">{fmtDate(s.payout_date)}</div></div>
                )}
              </div>
              {s.order_id && (
                <Link to={`/supplier/orders/${s.order_id}`} className="fs-caption" data-testid={`payout-order-${s.ref}`}>
                  View order →
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
