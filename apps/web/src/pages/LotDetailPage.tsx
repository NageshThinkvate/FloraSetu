import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addLotMedia, CustodyRow, custodyForLot, fmtDate, getLot, getLotMedia, LotDetail,
  LotMediaRow, mediaUrl, recordCustody, resolveLotHold, submitLotDeclaration, uploadMedia
} from '../lib/api/fulfilment';

// Lot traceability view: quantity balances, actual-lot media (signed URLs),
// reservations, and the append-only chain of custody.
export function LotDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [media, setMedia] = useState<LotMediaRow[]>([]);
  const [custody, setCustody] = useState<CustodyRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!id) return;
    setLot(await getLot(id));
    const [m, c] = await Promise.allSettled([getLotMedia(id), custodyForLot(id)]);
    if (m.status === 'fulfilled') setMedia(m.value.items);
    if (c.status === 'fulfilled') setCustody(c.value.items);
  };
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Lot unavailable'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const upload = async (e: ChangeEvent<HTMLInputElement>, purpose: 'LOT_ACTUAL' | 'LOT_VIDEO'): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const stored = await uploadMedia(file);
      await addLotMedia(id, { mediaObjectId: stored.id, purpose });
      setNotice(purpose === 'LOT_VIDEO' ? 'Video attached to lot.' : 'Photo of the actual lot attached.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  // ADR-011: supplier declaration + actual-lot evidence replaces any FloraSetu inspection.
  const declare = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    setError(''); setNotice('');
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await submitLotDeclaration(id, {
        declaredStemLengthCm: fd.get('stemLength') ? Number(fd.get('stemLength')) : undefined,
        bloomStage: String(fd.get('bloomStage') ?? '') || undefined,
        batchRef: String(fd.get('batchRef') ?? '') || undefined,
        notes: String(fd.get('notes') ?? '') || undefined
      });
      setNotice('Lot declared and listed as available.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Declaration failed');
    }
  };

  const resolveHold = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    setError(''); setNotice('');
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await resolveLotHold(id, {
        toAvailableQty: Number(fd.get('toAvailableQty')),
        toRejectedQty: Number(fd.get('toRejectedQty')),
        reason: String(fd.get('reason') ?? '') || undefined
      });
      setNotice('Hold resolved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hold resolution failed');
    }
  };

  const addCustody = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    setError(''); setNotice('');
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await recordCustody({
        lotId: id,
        eventType: String(fd.get('eventType')),
        locationText: String(fd.get('locationText') ?? '') || undefined,
        conditionNote: String(fd.get('conditionNote') ?? '') || undefined,
        temperatureC: fd.get('temperatureC') ? Number(fd.get('temperatureC')) : undefined
      });
      setNotice('Custody event recorded.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Custody event failed');
    }
  };

  if (error && !lot) {
    return (
      <main className="app-shell" data-testid="lot-denied">
        <header className="shell-header"><h1>Lot</h1></header>
        <p className="form-error" data-testid="lot-error">{error}</p>
      </main>
    );
  }
  if (!lot) {
    return <main className="app-shell" data-testid="lot-loading"><p className="hint">Loading…</p></main>;
  }

  return (
    <main className="app-shell" data-testid="lot-detail-page">
      <header className="shell-header">
        <h1>Lot <code data-testid="lot-ref">{lot.ref}</code></h1>
        <span className="state-chip" data-testid="lot-status">{lot.status}</span>
      </header>
      {error && <p className="form-error" data-testid="lot-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="lot-notice">{notice}</p>}

      <section className="panel" data-testid="lot-balances">
        <h2>Quantity balances</h2>
        <p>
          declared {lot.declared_qty} · available {lot.available_qty} · reserved {lot.reserved_qty} ·
          allocated {lot.allocated_qty} · packed {lot.packed_qty} · dispatched {lot.dispatched_qty} · delivered {lot.delivered_qty}
        </p>
        <p className="hint" data-testid="lot-quality-basis">
          {lot.quality_basis === 'SUPPLIER_DECLARATION' ? 'Supplier-declared quality' : 'Independent inspection'}
          {lot.harvest_at ? ` · harvested ${fmtDate(lot.harvest_at)}` : ''}
          {lot.received_at ? ` · received ${fmtDate(lot.received_at)}` : ''}
          {(Number(lot.qc_accepted_qty ?? 0) > 0 || Number(lot.qc_rejected_qty ?? 0) > 0 || Number(lot.qc_held_qty ?? 0) > 0)
            ? ` · inspection: accepted ${lot.qc_accepted_qty} · rejected ${lot.qc_rejected_qty} · held ${lot.qc_held_qty}`
            : ''}
        </p>
      </section>

      {lot.status === 'HOLD' && (
        <section className="panel" data-testid="lot-hold-panel">
          <h2>Resolve hold</h2>
          <p className="hint">Held quantity {lot.qc_held_qty} must be split exactly between release-to-available and write-off.</p>
          <form onSubmit={resolveHold} className="inline-form" data-testid="lot-hold-form">
            <input name="toAvailableQty" data-testid="lot-hold-available" type="number" min="0" step="any" placeholder="To available" required />
            <input name="toRejectedQty" data-testid="lot-hold-rejected" type="number" min="0" step="any" placeholder="To rejected" required />
            <input name="reason" data-testid="lot-hold-reason" placeholder="Reason" />
            <button type="submit" data-testid="lot-hold-btn">Resolve hold</button>
          </form>
        </section>
      )}

      <section className="panel" data-testid="lot-media-panel">
        <h2>Lot media ({media.length})</h2>
        <div className="inline-form">
          <label className="hint" htmlFor="lot-photo-input">Photo of actual lot</label>
          <input id="lot-photo-input" type="file" accept="image/*" capture="environment" data-testid="lot-media-input"
            disabled={busy} onChange={(e) => void upload(e, 'LOT_ACTUAL')} />
          <label className="hint" htmlFor="lot-video-input">Video of actual lot</label>
          <input id="lot-video-input" type="file" accept="video/*" data-testid="lot-video-input"
            disabled={busy} onChange={(e) => void upload(e, 'LOT_VIDEO')} />
        </div>
        <div className="module-grid" style={{ marginTop: 12 }}>
          {media.map((m) => (
            <article key={m.id} className="module-tile" data-testid={`lot-media-${m.id}`}>
              {m.url && <img src={mediaUrl(m.url)} alt={m.purpose} style={{ maxWidth: '100%', borderRadius: 8 }} />}
              <p>{m.purpose} · {fmtDate(m.captured_at)}</p>
            </article>
          ))}
        </div>
      </section>

      {lot.declared_at && (
        <section className="panel" data-testid="lot-declaration-panel">
          <h2>Supplier-declared quality</h2>
          <p data-testid="lot-declaration-summary">
            {lot.batch_ref ? `Batch ${lot.batch_ref} · ` : ''}
            {lot.bloom_stage ? `Bloom ${lot.bloom_stage.toLowerCase().replace(/_/g, ' ')} · ` : ''}
            {lot.declared_stem_length_cm ? `Stem ${lot.declared_stem_length_cm} cm · ` : ''}
            declared {fmtDate(lot.declared_at)}
          </p>
          {lot.declaration_notes && <p className="hint">{lot.declaration_notes}</p>}
        </section>
      )}

      {!lot.declared_at && ['STOCK_RECEIVED', 'HARVESTED'].includes(lot.status) && lot.quality_basis === 'SUPPLIER_DECLARATION' && (
        <section className="panel" data-testid="lot-declare-panel">
          <h2>Declare this lot</h2>
          <p className="hint" data-testid="lot-evidence-count">
            Actual-lot photos attached: {media.filter((m) => ['LOT_ACTUAL', 'LOT_PHOTO'].includes(m.purpose)).length}
            {' '}(minimum 2 required). Buyers see your photos and this declaration — FloraSetu does not inspect lots.
          </p>
          <form onSubmit={declare} className="inline-form" data-testid="lot-declare-form">
            <input name="stemLength" data-testid="lot-declare-stem" type="number" min="0" step="any" placeholder="Stem length (cm)" />
            <select name="bloomStage" data-testid="lot-declare-bloom" defaultValue="">
              <option value="">Bloom stage…</option>
              <option value="TIGHT_BUD">Tight bud</option>
              <option value="BUD">Bud</option>
              <option value="HALF_OPEN">Half open</option>
              <option value="OPEN">Open</option>
              <option value="FULL_BLOOM">Full bloom</option>
            </select>
            <input name="batchRef" data-testid="lot-declare-batch" placeholder="Batch reference (optional)" />
            <input name="notes" data-testid="lot-declare-notes" placeholder="Notes (optional)" />
            <button type="submit" data-testid="lot-declare-btn">Declare &amp; list as available</button>
          </form>
        </section>
      )}

      <section className="panel" data-testid="lot-custody-panel">
        <h2>Chain of custody ({custody.length})</h2>
        <ul className="plain-list">
          {custody.map((c) => (
            <li key={c.id} data-testid={`custody-row-${c.id}`}>
              <span className="state-chip">{c.event_type}</span>
              <span className="hint">{fmtDate(c.occurred_at)}</span>
              {c.location_text && <span>{c.location_text}</span>}
              {c.temperature_c !== null && <span>{c.temperature_c}°C</span>}
              {c.condition_note && <span className="hint">{c.condition_note}</span>}
            </li>
          ))}
        </ul>
        <form onSubmit={addCustody} className="inline-form" data-testid="custody-form">
          <input name="eventType" data-testid="custody-type" placeholder="Event type (e.g. STORAGE_HOLD)" required />
          <input name="locationText" data-testid="custody-location" placeholder="Location" />
          <input name="temperatureC" data-testid="custody-temp" type="number" step="any" placeholder="Temp °C" />
          <input name="conditionNote" data-testid="custody-note" placeholder="Condition note" />
          <button type="submit" data-testid="custody-btn">Record event</button>
        </form>
      </section>

      <section className="panel" data-testid="lot-reservations">
        <h2>Reservations ({lot.reservations.length})</h2>
        <ul className="plain-list">
          {lot.reservations.map((r) => (
            <li key={r.id} data-testid={`reservation-row-${r.id}`}>
              <span>{r.qty}</span>
              <span className="state-chip">{r.status}</span>
              <Link to={`/orders/${r.order_id}`} data-testid={`reservation-order-${r.id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
        {lot.reservations.length === 0 && <p className="hint">No reservations against this lot.</p>}
      </section>

      <p><Link to="/supply/lots" data-testid="lot-back">← Back to lots</Link></p>
    </main>
  );
}
