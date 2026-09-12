import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import {
  adjustSettlement, completeSettlement, fmtDate, PAYMENT_METHODS, recordPayment,
  recordSettlement, TowerExceptions, towerExceptions, verifyPayment, verifySettlement
} from '../lib/api/fulfilment';

// Finance desk (§22/§23): manual records of ACTUAL external payments and supplier
// settlements. No gateway, no escrow, no auto-success — verification is a separate
// human step and the recorder can never self-verify (§29).
export function FinancePage(): JSX.Element {
  const [tower, setTower] = useState<TowerExceptions | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => setTower(await towerExceptions());
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Finance desk unavailable'));
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const doPayment = async (e: FormEvent): Promise<void> => {
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
      'Payment recorded (RECORDED — a different finance user must verify).'
    );
    (e.target as HTMLFormElement).reset();
  };

  const doSettlement = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    let deductions: { label: string; amountMinor: number }[] | undefined;
    const rawDeductions = String(fd.get('deductions') ?? '').trim();
    if (rawDeductions) {
      try {
        const parsed = JSON.parse(rawDeductions) as { label: string; amountMinor: number }[];
        deductions = parsed.map((d) => ({ label: d.label, amountMinor: Math.round(Number(d.amountMinor)) }));
      } catch {
        setError('Deductions must be JSON like [{"label":"crate","amountMinor":15000}] (minor units).');
        return;
      }
    }
    await act(
      () => recordSettlement({
        orderId: String(fd.get('orderId')),
        supplierOrgId: String(fd.get('supplierOrgId')),
        grossMinor: Math.round(Number(fd.get('gross')) * 100),
        deductions,
        claimAdjustmentMinor: fd.get('claimAdjustment') ? Math.round(Number(fd.get('claimAdjustment')) * 100) : undefined,
        payoutRef: String(fd.get('payoutRef') ?? '') || undefined,
        payoutDate: fd.get('payoutDate') ? new Date(String(fd.get('payoutDate'))).toISOString() : undefined
      }),
      'Settlement recorded.'
    );
    (e.target as HTMLFormElement).reset();
  };

  const doAdjustment = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => adjustSettlement(String(fd.get('settlementId')), {
        direction: String(fd.get('direction')),
        amountMinor: Math.round(Number(fd.get('amount')) * 100),
        reason: String(fd.get('adjReason')),
        claimId: String(fd.get('claimId') ?? '') || undefined
      }),
      'Adjustment recorded against the completed settlement.'
    );
    (e.target as HTMLFormElement).reset();
  };

  if (error && !tower) {
    return (
      <main className="app-shell" data-testid="finance-denied">
        <header className="shell-header"><h1>Finance desk</h1></header>
        <p className="form-error" data-testid="finance-error">{error}</p>
      </main>
    );
  }

  return (
    <main className="app-shell" data-testid="finance-page">
      <header className="shell-header"><h1>Finance desk</h1></header>
      <p className="hint">Manual external records only — no gateway, no escrow. Recorder ≠ verifier.</p>
      {error && <p className="form-error" data-testid="finance-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="finance-notice">{notice}</p>}

      <section className="panel" data-testid="finance-record-payment">
        <h2>Record external buyer payment</h2>
        <form onSubmit={doPayment} className="inline-form" data-testid="finance-payment-form">
          <input name="orderId" data-testid="finance-payment-order" placeholder="Order UUID" required />
          <input name="amount" data-testid="finance-payment-amount" type="number" min="0.01" step="any" placeholder="Amount ₹" required />
          <select name="method" data-testid="finance-payment-method">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input name="externalRef" data-testid="finance-payment-ref" placeholder="UTR / external reference" required />
          <input name="paidAt" data-testid="finance-payment-paid-at" type="datetime-local" required />
          <button type="submit" disabled={busy} data-testid="finance-payment-btn">Record</button>
        </form>
      </section>

      <section className="panel" data-testid="finance-unverified">
        <h2>Payments awaiting verification ({tower?.paymentUnverified.length ?? 0})</h2>
        <ul className="plain-list">
          {(tower?.paymentUnverified ?? []).map((p) => (
            <li key={p.id} data-testid={`finance-payment-${p.id}`}>
              <code>{p.ref}</code>
              <span>{inr(p.amount_minor)}</span>
              <span className="hint">{fmtDate(p.created_at)}</span>
              <button className="ghost-btn" disabled={busy} data-testid={`finance-payment-verify-${p.id}`}
                onClick={() => void act(() => verifyPayment(p.id), 'Payment verified.')}>Verify</button>
              <Link to={`/orders/${p.order_id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="finance-record-settlement">
        <h2>Record supplier settlement</h2>
        <form onSubmit={doSettlement} className="inline-form" data-testid="finance-settlement-form">
          <input name="orderId" data-testid="finance-settlement-order" placeholder="Order UUID" required />
          <input name="supplierOrgId" data-testid="finance-settlement-supplier" placeholder="Supplier org UUID" required />
          <input name="gross" data-testid="finance-settlement-gross" type="number" min="0.01" step="any" placeholder="Gross ₹" required />
          <input name="claimAdjustment" data-testid="finance-settlement-claim-adj" type="number" min="0" step="any" placeholder="Claim adj ₹" />
          <input name="payoutRef" data-testid="finance-settlement-payout-ref" placeholder="Payout ref" />
          <input name="payoutDate" data-testid="finance-settlement-payout-date" type="datetime-local" />
          <input name="deductions" data-testid="finance-settlement-deductions" placeholder='Deductions JSON (optional)' />
          <button type="submit" disabled={busy} data-testid="finance-settlement-btn">Record</button>
        </form>
      </section>

      <section className="panel" data-testid="finance-pending-settlements">
        <h2>Settlements pending ({tower?.settlementPending.length ?? 0})</h2>
        <ul className="plain-list">
          {(tower?.settlementPending ?? []).map((s) => (
            <li key={s.id} data-testid={`finance-settlement-${s.id}`}>
              <code>{s.ref}</code>
              <span>net {inr(s.net_minor)}</span>
              <span className="state-chip">{s.status}</span>
              {s.status === 'RECORDED' && (
                <button className="ghost-btn" disabled={busy} data-testid={`finance-settlement-verify-${s.id}`}
                  onClick={() => void act(() => verifySettlement(s.id), 'Settlement verified.')}>Verify</button>
              )}
              {s.status === 'VERIFIED' && (
                <button className="ghost-btn" disabled={busy} data-testid={`finance-settlement-complete-${s.id}`}
                  onClick={() => void act(() => completeSettlement(s.id), 'Settlement completed (payout done).')}>Complete</button>
              )}
              <Link to={`/orders/${s.order_id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="finance-adjustment">
        <h2>Post-settlement adjustment (ADR-003)</h2>
        <p className="hint">Completed settlements are immutable — corrections are recorded as adjustment rows.</p>
        <form onSubmit={doAdjustment} className="inline-form" data-testid="finance-adjustment-form">
          <input name="settlementId" data-testid="finance-adj-settlement" placeholder="Settlement UUID (COMPLETED)" required />
          <select name="direction" data-testid="finance-adj-direction">
            <option value="CREDIT">CREDIT</option>
            <option value="DEBIT">DEBIT</option>
          </select>
          <input name="amount" data-testid="finance-adj-amount" type="number" min="0.01" step="any" placeholder="Amount ₹" required />
          <input name="adjReason" data-testid="finance-adj-reason" placeholder="Reason" required />
          <input name="claimId" data-testid="finance-adj-claim" placeholder="Claim UUID (optional)" />
          <button type="submit" disabled={busy} data-testid="finance-adj-btn">Record adjustment</button>
        </form>
      </section>
    </main>
  );
}
