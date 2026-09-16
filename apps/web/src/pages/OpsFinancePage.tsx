import { FormEvent, useCallback, useEffect, useState } from 'react';
import { BoardItem, OpsOrder, towerBoard, towerOrders } from '../lib/api/tower';
import {
  completeSettlement, PAYMENT_METHODS, recordPayment, recordSettlement, verifyPayment, verifySettlement
} from '../lib/api/fulfilment';
import { apiGet } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';
import { SideSheet } from '../components/SideSheet';

interface BankChangeRequest { id: string; status: string; payout_freeze: boolean; created_at: string }

const fmtDateTime = (v: string | null): string =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

// ADR-013: finance operations workspace on the existing accepted finance endpoints.
// §22/§23: manual records of ACTUAL external money movement — no gateway, no escrow.
// §29 dual control preserved: the recorder can never verify/complete the same record;
// the backend rejects self-verification regardless of what this page renders.
// ADR-004: payout freezes surface from the audited bank-change workflow (read-only here);
// no unilateral freeze/unfreeze capability exists.
export function OpsFinancePage(): JSX.Element {
  const { me, activeOrgId } = useAuth();
  const roles = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles ?? [];
  const canFinance = roles.includes('FINANCE_OPS') || roles.includes('PLATFORM_ADMIN');

  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [orders, setOrders] = useState<OpsOrder[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BoardItem | null>(null);
  const [freeze, setFreeze] = useState<BankChangeRequest | null>(null);

  const load = useCallback((): void => {
    setItems(null);
    towerBoard()
      .then((r) => setItems(r.items.filter((i) => i.discipline === 'FINANCE')))
      .catch(() => setError("We couldn't load the finance queues. Try again."));
    towerOrders().then((r) => setOrders(r.items)).catch(() => setOrders([]));
  }, []);
  useEffect(load, [load]);

  // ADR-004 read-only visibility: open payout-freezing bank change for the item's org.
  useEffect(() => {
    setFreeze(null);
    if (!selected?.orderId || !canFinance) {
      return;
    }
    const order = orders.find((o) => o.id === selected.orderId);
    const supplierOrgId = order?.supplierOrgIds[0];
    if (!supplierOrgId) {
      return;
    }
    apiGet<{ items: BankChangeRequest[] }>(`/orgs/${supplierOrgId}/bank/change-requests`)
      .then((r) => setFreeze(r.items.find((c) => c.payout_freeze && ['PENDING_REVERIFICATION', 'APPROVED_FIRST'].includes(c.status)) ?? null))
      .catch(() => setFreeze(null));
  }, [selected, orders, canFinance]);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      setSelected(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action could not be completed. Dual-control rules may require a different reviewer.');
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (item: BoardItem, key: string): Promise<void> => {
    if (key === 'verify-payment') {
      await act(() => verifyPayment(item.objectId), 'Payment verified.');
    } else if (key === 'verify-settlement') {
      await act(() => verifySettlement(item.objectId), 'Settlement verified.');
    } else if (key === 'complete-settlement') {
      await act(() => completeSettlement(item.objectId), 'Settlement completed.');
    }
  };

  const submitPayment = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => recordPayment({
        orderId: String(fd.get('orderId')),
        amountMinor: Math.round(Number(fd.get('amount')) * 100),
        method: String(fd.get('method')),
        externalRef: String(fd.get('externalRef')),
        paidAt: new Date(String(fd.get('paidAt'))).toISOString()
      }),
      'Payment recorded. A second finance reviewer must verify it.'
    );
    (e.target as HTMLFormElement).reset();
  };

  const submitSettlement = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const payoutDate = String(fd.get('payoutDate') ?? '');
    await act(
      () => recordSettlement({
        orderId: String(fd.get('orderId')),
        supplierOrgId: String(fd.get('supplierOrgId')),
        grossMinor: Math.round(Number(fd.get('gross')) * 100),
        payoutRef: String(fd.get('payoutRef') ?? '') || undefined,
        payoutDate: payoutDate ? new Date(payoutDate).toISOString() : undefined
      }),
      'Settlement recorded. A second finance reviewer must verify it.'
    );
    (e.target as HTMLFormElement).reset();
  };

  const orderSuppliers = (orderId: string): { id: string; name: string }[] => {
    const o = orders.find((x) => x.id === orderId);
    return o ? o.supplierOrgIds.map((id, i) => ({ id, name: o.supplierNames[i] ?? 'Supplier' })) : [];
  };

  return (
    <div data-testid="ops-finance-page">
      <PageHeader overline="Operations — finance" title="Payments & settlements" testId="ops-finance-header" />
      {error && <InlineAlert variant="error" testId="ops-finance-error">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="ops-finance-notice">{notice}</InlineAlert>}

      <h2 className="fs-heading-3" data-testid="ops-finance-queue-title">Needs verification</h2>
      {items === null && !error && <SkeletonLoader variant="card" count={3} testId="ops-finance-loading" />}
      {items !== null && items.length === 0 && (
        <EmptyState
          title="Nothing awaiting finance action"
          hint="Recorded payments and settlements needing a second reviewer will appear here."
          testId="ops-finance-empty"
        />
      )}
      <div className="fs-md-stack" data-testid="ops-finance-queue">
        {(items ?? []).map((i) => (
          <button
            key={i.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`ops-finance-item-${i.objectId.slice(0, 8)}`}
            onClick={() => setSelected(i)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{i.title}</span>
              <span className="fs-body">{i.ref}</span>
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Organization</div>
                <div className="fs-md-card__field-value">{i.orgName ?? '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">State</div>
                <div className="fs-md-card__field-value">{i.state}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Recorded</div>
                <div className="fs-md-card__field-value">{fmtDateTime(i.detectedAt)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {canFinance && (
        <>
          <div className="fs-card fs-md-card" data-testid="ops-finance-record-payment">
            <h2 className="fs-heading-3">Record a payment received</h2>
            <p className="fs-body">
              Record an ACTUAL external payment (bank transfer, UPI). This is a record of money that
              already moved — never a gateway charge. You cannot verify a payment you recorded.
            </p>
            <form onSubmit={(e) => void submitPayment(e)} className="fs-md-stack" data-testid="ops-finance-payment-form">
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="ops-pay-order">Order</label>
                <select id="ops-pay-order" name="orderId" className="fs-input" data-testid="ops-pay-order" required>
                  <option value="">Choose order…</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.ref}{o.buyerName ? ` · ${o.buyerName}` : ''}</option>)}
                </select>
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="ops-pay-amount">Amount (₹)</label>
                <input id="ops-pay-amount" name="amount" className="fs-input" data-testid="ops-pay-amount" type="number" min="0.01" step="any" required />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="ops-pay-method">Method</label>
                <select id="ops-pay-method" name="method" className="fs-input" data-testid="ops-pay-method" required>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.toLowerCase().replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="ops-pay-ref">Bank reference / UTR</label>
                <input id="ops-pay-ref" name="externalRef" className="fs-input" data-testid="ops-pay-ref" required maxLength={120} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="ops-pay-at">Paid at</label>
                <input id="ops-pay-at" name="paidAt" className="fs-input" data-testid="ops-pay-at" type="datetime-local" required />
              </div>
              <button type="submit" className="fs-btn" disabled={busy} data-testid="ops-pay-submit">Record payment</button>
            </form>
          </div>

          <SettlementForm orders={orders} orderSuppliers={orderSuppliers} busy={busy} onSubmit={submitSettlement} />
        </>
      )}
      {!canFinance && (
        <p className="fs-body" data-testid="ops-finance-readonly-note">
          Your role can view finance queues. Recording, verification and completion belong to the finance role.
        </p>
      )}

      <SideSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? selected.title : ''}
        testId="ops-finance-sheet"
      >
        {selected && (
          <div className="fs-md-stack" data-testid="ops-finance-sheet-body">
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{selected.ref}</span>
              <span className="fs-body">{selected.state}</span>
            </div>
            <div className="fs-md-card__fields">
              <div><div className="fs-md-card__field-label">Organization</div><div className="fs-md-card__field-value">{selected.orgName ?? '—'}</div></div>
              <div><div className="fs-md-card__field-label">Recorded</div><div className="fs-md-card__field-value">{fmtDateTime(selected.detectedAt)}</div></div>
              <div><div className="fs-md-card__field-label">Next action owner</div><div className="fs-md-card__field-value">{selected.nextOwner}</div></div>
            </div>
            {freeze && (
              <InlineAlert variant="warning" testId="ops-finance-freeze">
                Payout frozen — a bank detail change for this organization is awaiting dual approval
                (requested {fmtDateTime(freeze.created_at)}). Settlements must not be paid out to the
                new account until re-verification completes.
              </InlineAlert>
            )}
            {selected.allowedActions.map((a) => (
              <button
                key={a.key}
                className="fs-btn"
                disabled={busy}
                data-testid={`ops-finance-action-${a.key}`}
                onClick={() => void runAction(selected, a.key)}
              >
                {a.label}
              </button>
            ))}
            <p className="fs-body" style={{ margin: 0 }}>
              Dual control (§29): the person who recorded this record can never verify or complete it —
              a second finance reviewer must. Verification is a human step; nothing auto-succeeds.
            </p>
          </div>
        )}
      </SideSheet>
    </div>
  );
}

function SettlementForm({
  orders, orderSuppliers, busy, onSubmit
}: {
  orders: OpsOrder[];
  orderSuppliers: (orderId: string) => { id: string; name: string }[];
  busy: boolean;
  onSubmit: (e: FormEvent) => Promise<void>;
}): JSX.Element {
  const [orderId, setOrderId] = useState('');
  return (
    <div className="fs-card fs-md-card" data-testid="ops-finance-record-settlement">
      <h2 className="fs-heading-3">Record a supplier settlement</h2>
      <p className="fs-body">
        Record the settlement for a delivered order. Adjustments from decided claims apply as
        immutable adjustment records — never edits. You cannot verify a settlement you recorded.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="fs-md-stack" data-testid="ops-finance-settlement-form">
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="ops-set-order">Order</label>
          <select
            id="ops-set-order"
            name="orderId"
            className="fs-input"
            data-testid="ops-set-order"
            required
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          >
            <option value="">Choose order…</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.ref}{o.buyerName ? ` · ${o.buyerName}` : ''}</option>)}
          </select>
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="ops-set-supplier">Supplier</label>
          <select id="ops-set-supplier" name="supplierOrgId" className="fs-input" data-testid="ops-set-supplier" required>
            <option value="">Choose supplier…</option>
            {orderSuppliers(orderId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="ops-set-gross">Gross amount (₹)</label>
          <input id="ops-set-gross" name="gross" className="fs-input" data-testid="ops-set-gross" type="number" min="0.01" step="any" required />
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="ops-set-payout-ref">Payout reference (optional)</label>
          <input id="ops-set-payout-ref" name="payoutRef" className="fs-input" data-testid="ops-set-payout-ref" maxLength={120} />
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="ops-set-payout-date">Payout date (optional)</label>
          <input id="ops-set-payout-date" name="payoutDate" className="fs-input" data-testid="ops-set-payout-date" type="datetime-local" />
        </div>
        <button type="submit" className="fs-btn" disabled={busy} data-testid="ops-set-submit">Record settlement</button>
      </form>
    </div>
  );
}
