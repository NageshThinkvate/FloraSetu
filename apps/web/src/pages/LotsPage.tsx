import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listProducts, ProductSummary } from '../lib/api/demand';
import { fmtDate, listMyLots, LotSummary } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

// Supplier supply desk (Phase 4): lot cards with live balances and evidence state.
// Intake happens in the camera-first wizard at /supplier/supply/new.
export function LotsPage(): JSX.Element {
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);

  useEffect(() => {
    listMyLots().then((r) => setLots(r.items)).catch(() => setLots([]));
    listProducts().then((r) => setProducts(r.items)).catch(() => undefined);
  }, []);

  if (lots === null) {
    return <SkeletonLoader variant="card" count={3} testId="lots-loading" />;
  }

  return (
    <div data-testid="supplier-lots">
      <PageHeader
        overline="Supply"
        title="Your supply"
        testId="lots-header"
        actions={<Link to="/supplier/supply/new" className="fs-btn" data-testid="lots-add-supply">Add supply</Link>}
      />
      {lots.length === 0 && (
        <EmptyState
          title="No supply yet"
          hint="Add your first lot — photos first, then flower, quantity and your declaration. It takes two minutes."
          actionLabel="Add supply"
          onAction={() => { window.location.href = '/supplier/supply/new'; }}
          testId="lots-empty"
        />
      )}
      <div className="fs-md-stack">
        {lots.map((l) => {
          const needsEvidence = ['STOCK_RECEIVED', 'HARVESTED'].includes(l.status);
          return (
            <TaskCard
              key={l.id}
              testId={`lot-card-${l.id.slice(0, 8)}`}
              title={products.find((p) => p.id === l.commodity_id)?.name ?? 'Supply lot'}
              meta={[
                `${l.available_qty} available of ${l.declared_qty}`,
                l.harvest_at ? `harvested ${fmtDate(l.harvest_at)}` : l.received_at ? `received ${fmtDate(l.received_at)}` : '',
                `${l.media_count} photo${l.media_count === 1 ? '' : 's'}`
              ].filter(Boolean)}
              status={l.status}
              statusLabel={needsEvidence ? 'Needs evidence' : undefined}
              footer={
                <span style={{ display: 'flex', gap: 'var(--fs-space-2)' }}>
                  <Link className="fs-btn fs-btn--sm" data-testid={`lot-open-${l.id}`} to={`/supplier/supply/${l.id}`}>Open</Link>
                  {needsEvidence && (
                    <Link className="fs-btn fs-btn--sm fs-btn--ghost" data-testid={`lot-declare-${l.id}`} to={`/supplier/supply/${l.id}`}>
                      Add photos &amp; declare
                    </Link>
                  )}
                </span>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
