import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addSourcingNote, opsDesk, OpsDesk } from '../lib/api/demand';

export function OpsDeskPage(): JSX.Element {
  const [desk, setDesk] = useState<OpsDesk | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const load = async (): Promise<void> => setDesk(await opsDesk());
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Desk unavailable'));
  }, []);

  const saveNote = async (requirementId: string): Promise<void> => {
    setError(''); setNotice('');
    try {
      await addSourcingNote(requirementId, note[requirementId]);
      setNotice('Sourcing note recorded.');
      setNote({ ...note, [requirementId]: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Note failed');
    }
  };

  if (error && !desk) {
    return (
      <main className="app-shell" data-testid="ops-desk-denied">
        <header className="shell-header"><h1>Procurement desk</h1></header>
        <p className="form-error" data-testid="ops-error">{error}</p>
      </main>
    );
  }
  if (!desk) {
    return <main className="app-shell" data-testid="ops-desk-loading"><p className="hint">Loading…</p></main>;
  }

  return (
    <main className="app-shell" data-testid="ops-desk">
      <header className="shell-header"><h1>Procurement desk</h1></header>
      {error && <p className="form-error" data-testid="ops-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="ops-notice">{notice}</p>}

      <section className="panel" data-testid="ops-needs-sourcing">
        <h2>Needs sourcing ({desk.needsSourcing.length})</h2>
        <ul className="plain-list">
          {desk.needsSourcing.map((r) => (
            <li key={r.id} data-testid={`ops-req-${r.id}`}>
              <code>{r.ref}</code>
              <span>{r.title}</span>
              <span className="state-chip">{r.mode}</span>
              <span className="inline-form">
                <input data-testid={`ops-note-${r.id}`} placeholder="Sourcing note…" value={note[r.id] ?? ''}
                  onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                <button className="ghost-btn" data-testid={`ops-note-btn-${r.id}`}
                  disabled={!(note[r.id] ?? '').trim()} onClick={() => void saveNote(r.id)}>
                  Note
                </button>
              </span>
              <Link to={`/demand/requirements/${r.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="ops-open-rfqs">
        <h2>Open RFQs ({desk.openRfqs.length})</h2>
        <ul className="plain-list">
          {desk.openRfqs.map((r) => (
            <li key={r.id} data-testid={`ops-rfq-${r.id}`}>
              <code>{r.ref}</code>
              <span>{r.title}</span>
              <span className="hint">{r.invited} invited · {r.quotes} quotes</span>
              {r.deadlineRisk && <span className="state-chip frozen">deadline risk</span>}
              <Link to={`/demand/rfqs/${r.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="ops-uncovered">
        <h2>Uncovered demand ({desk.uncoveredDemand.length})</h2>
        <ul className="plain-list">
          {desk.uncoveredDemand.map((r) => (
            <li key={r.id} data-testid={`ops-uncovered-${r.id}`}>
              <code>{r.ref}</code>
              <span>{r.title}</span>
              <span className="hint">remaining {r.remaining_qty}</span>
              <span className="state-chip">{r.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="ops-clarifications">
        <h2>Open clarifications ({desk.openClarifications.length})</h2>
        <ul className="plain-list">
          {desk.openClarifications.map((c) => (
            <li key={c.id} data-testid={`ops-clarification-${c.id}`}>
              <code>{c.rfq_ref}</code>
              <span>{c.question}</span>
              <span className="hint">{new Date(c.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="ops-assistance">
        <h2>Assistance requested ({desk.assistanceRequested.length})</h2>
        <ul className="plain-list">
          {desk.assistanceRequested.map((r) => (
            <li key={r.id} data-testid={`ops-assist-${r.id}`}>
              <code>{r.ref}</code>
              <span>{r.title}</span>
              <span className="state-chip">{r.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
