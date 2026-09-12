import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  completeInspection, createInspection, QcQueueLot, qcQueue
} from '../lib/api/fulfilment';

// Ops QC workbench: lots awaiting inspection → open an inspection (conflict-controlled)
// → complete with accepted/rejected/held split against a pinned grade-profile version.
export function QcQueuePage(): JSX.Element {
  const [queue, setQueue] = useState<QcQueueLot[] | null>(null);
  const [openFor, setOpenFor] = useState<QcQueueLot | null>(null);
  const [inspection, setInspection] = useState<{ id: string; ref: string; lotId: string; gradeProfileId: string | null } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => setQueue((await qcQueue()).items);
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'QC queue unavailable'));
  }, []);

  const openInspection = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!openFor) return;
    setError(''); setNotice(''); setBusy(true);
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      const created = await createInspection({
        lotId: openFor.id,
        scope: String(fd.get('scope')),
        notes: String(fd.get('notes') ?? '') || undefined,
        conflictOverrideReason: String(fd.get('conflictOverrideReason') ?? '') || undefined
      });
      setInspection({ id: created.id, ref: created.ref, lotId: created.lotId, gradeProfileId: openFor.gradeProfileId });
      setOpenFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open inspection');
    } finally {
      setBusy(false);
    }
  };

  const complete = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!inspection) return;
    setError(''); setNotice('');
    const fd = new FormData(e.target as HTMLFormElement);
    let measurements: Record<string, unknown>;
    try {
      measurements = JSON.parse(String(fd.get('measurements') ?? '{}') || '{}') as Record<string, unknown>;
    } catch {
      setError('Measurements must be valid JSON, e.g. {"stem_length_cm": 60}');
      return;
    }
    const gradeProfileId = String(fd.get('gradeProfileId') ?? '');
    if (!gradeProfileId) {
      setError('Grade profile ID is required — results are pinned to a versioned profile.');
      return;
    }
    setBusy(true);
    try {
      const res = await completeInspection(inspection.id, {
        acceptedQty: Number(fd.get('acceptedQty')),
        rejectedQty: Number(fd.get('rejectedQty')),
        heldQty: Number(fd.get('heldQty')),
        gradeResults: [{ gradeProfileId, measurements }],
        notes: String(fd.get('qcNotes') ?? '') || undefined
      });
      setNotice(`Inspection ${inspection.ref} completed — lot is now ${res.lotStatus}.`);
      setInspection(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Completion failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !queue) {
    return (
      <main className="app-shell" data-testid="qc-denied">
        <header className="shell-header"><h1>QC queue</h1></header>
        <p className="form-error" data-testid="qc-error">{error}</p>
      </main>
    );
  }

  return (
    <main className="app-shell" data-testid="qc-queue-page">
      <header className="shell-header"><h1>QC queue</h1></header>
      {error && <p className="form-error" data-testid="qc-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="qc-notice">{notice}</p>}

      <section className="panel" data-testid="qc-queue-panel">
        <h2>Lots awaiting inspection ({queue?.length ?? 0})</h2>
        <ul className="plain-list">
          {(queue ?? []).map((l) => (
            <li key={l.id} data-testid={`qc-lot-${l.id}`}>
              <span>declared {l.declaredQty ?? '—'}</span>
              <span className="hint">origin {l.originType}</span>
              <Link to={`/supply/lots/${l.id}`} data-testid={`qc-lot-open-${l.id}`}><button className="ghost-btn">Lot</button></Link>
              <button data-testid={`qc-open-${l.id}`} onClick={() => setOpenFor(l)}>Inspect</button>
            </li>
          ))}
        </ul>
        {(queue ?? []).length === 0 && <p className="hint" data-testid="qc-empty">No lots awaiting QC.</p>}
      </section>

      {openFor && (
        <section className="panel" data-testid="qc-open-panel">
          <h2>Open inspection — lot {openFor.id.slice(0, 8)}…</h2>
          <form onSubmit={openInspection} className="inline-form" data-testid="qc-open-form">
            <select name="scope" data-testid="qc-scope" required>
              <option value="SAMPLE">SAMPLE</option>
              <option value="FULL">FULL</option>
            </select>
            <input name="notes" data-testid="qc-open-notes" placeholder="Notes (optional)" />
            <input name="conflictOverrideReason" data-testid="qc-conflict-reason"
              placeholder="Conflict override reason (only if inspecting own org's lot)" />
            <button type="submit" disabled={busy} data-testid="qc-open-btn">Open inspection</button>
            <button type="button" className="ghost-btn" data-testid="qc-open-cancel" onClick={() => setOpenFor(null)}>Cancel</button>
          </form>
        </section>
      )}

      {inspection && (
        <section className="panel" data-testid="qc-complete-panel">
          <h2>Complete inspection <code>{inspection.ref}</code></h2>
          <form onSubmit={complete} data-testid="qc-complete-form">
            <div className="inline-form">
              <input name="acceptedQty" data-testid="qc-accepted" type="number" min="0" step="any" placeholder="Accepted qty" required />
              <input name="rejectedQty" data-testid="qc-rejected" type="number" min="0" step="any" placeholder="Rejected qty" required />
              <input name="heldQty" data-testid="qc-held" type="number" min="0" step="any" placeholder="Held qty" required />
            </div>
            <label>Grade profile ID
              <input name="gradeProfileId" data-testid="qc-grade-profile" defaultValue={inspection.gradeProfileId ?? ''} required />
            </label>
            <label>Measurements (JSON)
              <input name="measurements" data-testid="qc-measurements" defaultValue="{}" />
            </label>
            <label>Notes (optional)
              <input name="qcNotes" data-testid="qc-complete-notes" />
            </label>
            <div className="inline-form">
              <button type="submit" disabled={busy} data-testid="qc-complete-btn">{busy ? 'Saving…' : 'Complete inspection'}</button>
              <button type="button" className="ghost-btn" data-testid="qc-complete-cancel" onClick={() => setInspection(null)}>Cancel</button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
