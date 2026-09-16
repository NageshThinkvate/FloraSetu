import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BoardItem, SearchHit, towerBoard, towerBoardExport, towerSearch } from '../lib/api/tower';
import { completeSettlement, convertAward, resolveShipmentException, verifyPayment, verifySettlement } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';
import { SideSheet } from '../components/SideSheet';
import { useToast } from '../lib/toast';

const LANE_LABEL: Record<BoardItem['discipline'], string> = {
  PROCUREMENT: 'Procurement',
  ORDERS: 'Orders',
  LOGISTICS: 'Logistics',
  CLAIMS: 'Claims & support',
  FINANCE: 'Finance'
};

// Severity is communicated with text, never colour alone (§22/§32).
const SEV_LABEL: Record<BoardItem['severity'], string> = {
  CRITICAL: 'Critical',
  URGENT: 'Urgent',
  ATTENTION: 'Attention',
  INFO: 'Info'
};

const ageLabel = (iso: string): string => {
  const h = (Date.now() - new Date(iso).getTime()) / 3600e3;
  if (h < 1) {
    return `${Math.max(1, Math.round(h * 60))} min ago`;
  }
  if (h < 24) {
    return `${Math.round(h)} hrs ago`;
  }
  return `${Math.round(h / 24)} days ago`;
};

const dueLabel = (iso: string): string => {
  const h = (new Date(iso).getTime() - Date.now()) / 3600e3;
  if (h < 0) {
    const oh = Math.round(-h);
    return oh < 24 ? `overdue by ${oh} hrs` : `overdue by ${Math.round(-h / 24)} days`;
  }
  return h < 24 ? `due in ${Math.max(1, Math.round(h))} hrs` : `due in ${Math.round(h / 24)} days`;
};

// ADR-013: the board renders backend-computed allowedActions only — authority is never
// decided in the frontend. Domain state changes still happen through the domain endpoints.
export function ControlTowerPage(): JSX.Element {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lane = params.get('lane') ?? 'all';
  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BoardItem | null>(null);
  const [resolution, setResolution] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((): void => {
    setItems(null);
    towerBoard()
      .then((r) => setItems(r.items))
      .catch(() => setError("We couldn't load the exception board. Try again."));
  }, []);
  useEffect(load, [load]);

  const onSearch = (v: string): void => {
    setQuery(v);
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    if (v.trim().length < 2) {
      setHits([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      towerSearch(v).then((r) => setHits(r.items)).catch(() => setHits([]));
    }, 300);
  };

  const runAction = async (item: BoardItem, key: string): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      switch (key) {
        case 'convert-award':
          await convertAward(item.objectId);
          toast('Order created from award');
          break;
        case 'resolve-exception':
          if (!resolution.trim()) {
            setError('Add a resolution note before resolving.');
            return;
          }
          await resolveShipmentException(item.objectId, resolution.trim());
          toast('Issue resolved');
          setResolution('');
          break;
        case 'verify-payment':
          await verifyPayment(item.objectId);
          toast('Payment verified');
          break;
        case 'verify-settlement':
          await verifySettlement(item.objectId);
          toast('Settlement verified');
          break;
        case 'complete-settlement':
          await completeSettlement(item.objectId);
          toast('Settlement completed');
          break;
        case 'open-procurement':
          navigate('/ops/procurement');
          return;
        default:
          return;
      }
      setSelected(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That action could not be completed. Check your permissions and the record state.');
    } finally {
      setBusy(false);
    }
  };

  const shown = (items ?? []).filter((i) => lane === 'all' || i.discipline === lane);
  const lanes = Object.entries(LANE_LABEL) as [BoardItem['discipline'], string][];

  return (
    <div data-testid="ops-exceptions-page">
      <PageHeader
        overline="Operations"
        title="What needs attention now"
        testId="ops-exceptions-header"
        actions={
          <button
            className="fs-btn fs-btn--secondary fs-btn--sm"
            data-testid="ops-board-export"
            onClick={() => void towerBoardExport().catch(() => setError('Export failed. Try again.'))}
          >
            Export CSV
          </button>
        }
      />
      <div className="fs-field" style={{ maxWidth: 420 }} data-testid="ops-search-wrap">
        <label className="fs-field__label" htmlFor="ops-search">Search orders, references, claims, organizations</label>
        <input
          id="ops-search"
          className="fs-input"
          data-testid="ops-search"
          placeholder="e.g. ORD-2026, REQ-…, claim or organization name"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
        />
        {hits.length > 0 && (
          <div className="fs-card" style={{ marginTop: 'var(--fs-space-1)' }} data-testid="ops-search-results">
            {hits.map((h) => (
              <button
                key={`${h.type}:${h.id}`}
                type="button"
                className="fs-btn fs-btn--ghost fs-btn--sm"
                style={{ display: 'block', width: '100%', textAlign: 'left' }}
                data-testid={`ops-search-hit-${h.type}-${h.id.slice(0, 8)}`}
                onClick={() => {
                  setHits([]);
                  setQuery('');
                  navigate(h.href);
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <InlineAlert variant="error" testId="ops-board-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="ops-board-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', margin: 'var(--fs-space-3) 0' }} data-testid="ops-board-lanes">
        <button
          type="button"
          className={`fs-btn fs-btn--sm ${lane === 'all' ? '' : 'fs-btn--ghost'}`}
          aria-pressed={lane === 'all'}
          data-testid="ops-lane-all"
          onClick={() => { const next = new URLSearchParams(params); next.delete('lane'); setParams(next, { replace: true }); }}
        >
          All
        </button>
        {lanes.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`fs-btn fs-btn--sm ${lane === key ? '' : 'fs-btn--ghost'}`}
            aria-pressed={lane === key}
            data-testid={`ops-lane-${key.toLowerCase()}`}
            onClick={() => { const next = new URLSearchParams(params); next.set('lane', key); setParams(next, { replace: true }); }}
          >
            {label}
          </button>
        ))}
      </div>
      {items === null && !error && <SkeletonLoader variant="card" count={4} testId="ops-board-loading" />}
      {items !== null && shown.length === 0 && (
        <EmptyState
          title="No exceptions need attention"
          hint="When procurement, order, logistics, claim or finance work needs FloraSetu staff, it will appear here."
          testId="ops-board-empty"
        />
      )}
      <div className="fs-md-stack" data-testid="ops-board-list">
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`board-item-${i.id}`}
            onClick={() => { setSelected(i); setResolution(''); setError(''); }}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{i.title}</span>
              <span className="fs-body" data-testid={`board-severity-${i.id}`}>{SEV_LABEL[i.severity]}</span>
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Reference</div>
                <div className="fs-md-card__field-value">{i.ref}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Area</div>
                <div className="fs-md-card__field-value">{LANE_LABEL[i.discipline]}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Organization</div>
                <div className="fs-md-card__field-value">{i.orgName ?? '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Next action owner</div>
                <div className="fs-md-card__field-value" data-testid={`board-owner-${i.id}`}>{i.nextOwner}</div>
              </div>
            </div>
            <p className="fs-body" style={{ margin: 0 }}>
              {ageLabel(i.detectedAt)}{i.dueAt ? ` · ${dueLabel(i.dueAt)}` : ''}
              {i.allowedActions.length > 0 ? ` · You can: ${i.allowedActions.map((a) => a.label).join(', ')}` : ''}
            </p>
          </button>
        ))}
      </div>
      <SideSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? selected.title : ''}
        testId="ops-board-sheet"
      >
        {selected && (
          <div className="fs-md-stack" data-testid="ops-board-sheet-body">
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{selected.ref}</span>
              <StatusPill status={selected.state} label={selected.state === 'FINAL' ? 'Ready to convert' : undefined} />
            </div>
            <div className="fs-md-card__fields">
              <div><div className="fs-md-card__field-label">Area</div><div className="fs-md-card__field-value">{LANE_LABEL[selected.discipline]}</div></div>
              <div><div className="fs-md-card__field-label">Severity</div><div className="fs-md-card__field-value">{SEV_LABEL[selected.severity]}</div></div>
              <div><div className="fs-md-card__field-label">Organization</div><div className="fs-md-card__field-value">{selected.orgName ?? '—'}</div></div>
              <div><div className="fs-md-card__field-label">Next action owner</div><div className="fs-md-card__field-value">{selected.nextOwner}</div></div>
              <div><div className="fs-md-card__field-label">Detected</div><div className="fs-md-card__field-value">{ageLabel(selected.detectedAt)}</div></div>
              {selected.dueAt && <div><div className="fs-md-card__field-label">Deadline</div><div className="fs-md-card__field-value">{dueLabel(selected.dueAt)}</div></div>}
            </div>
            {selected.allowedActions.some((a) => a.key === 'resolve-exception') && (
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="ops-resolution">Resolution note</label>
                <input
                  id="ops-resolution"
                  className="fs-input"
                  data-testid="ops-resolution-input"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                />
              </div>
            )}
            {selected.allowedActions.map((a) => (
              <button
                key={a.key}
                className="fs-btn"
                disabled={busy}
                data-testid={`board-action-${a.key}`}
                onClick={() => void runAction(selected, a.key)}
              >
                {a.label}
              </button>
            ))}
            <button
              className="fs-btn fs-btn--ghost"
              data-testid="board-open-workspace"
              onClick={() => navigate(selected.href)}
            >
              Open in workspace
            </button>
            <p className="fs-body" style={{ margin: 0 }}>
              Resolving this item never changes the underlying business record — domain state moves only through the responsible party's own workflow.
            </p>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
