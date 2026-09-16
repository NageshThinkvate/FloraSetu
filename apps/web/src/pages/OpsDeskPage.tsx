import { useEffect, useState } from 'react';
import { addSourcingNote, opsDesk, OpsDesk } from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Operations procurement desk (Phase 8: design-system rebuild — functionality unchanged;
// broken cross-shell /demand links removed, the desk itself is the workspace).
export function OpsDeskPage(): JSX.Element {
  const [desk, setDesk] = useState<OpsDesk | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const load = async (): Promise<void> => setDesk(await opsDesk());
  useEffect(() => {
    void load().catch(() => setError("We couldn't load the procurement desk. Try again."));
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
      <div data-testid="ops-desk-denied">
        <PageHeader overline="Operations" title="Procurement desk" testId="ops-desk-header" />
        <InlineAlert variant="error" testId="ops-error">{error}</InlineAlert>
      </div>
    );
  }
  if (!desk) {
    return (
      <div data-testid="ops-desk-loading">
        <PageHeader overline="Operations" title="Procurement desk" testId="ops-desk-header" />
        <SkeletonLoader variant="card" count={3} testId="ops-desk-skeleton" />
      </div>
    );
  }

  const empty = desk.needsSourcing.length === 0 && desk.openRfqs.length === 0
    && desk.uncoveredDemand.length === 0 && desk.openClarifications.length === 0
    && desk.assistanceRequested.length === 0;

  return (
    <div data-testid="ops-desk">
      <PageHeader overline="Operations" title="Procurement desk" testId="ops-desk-header" />
      {error && <InlineAlert variant="error" testId="ops-error-inline">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="ops-notice">{notice}</InlineAlert>}
      {empty && (
        <EmptyState
          title="Nothing needs the sourcing desk"
          hint="New demand, quote activity and buyer questions will appear here."
          testId="ops-desk-empty"
        />
      )}

      {desk.needsSourcing.length > 0 && (
        <>
          <h2 className="fs-heading-3" data-testid="ops-needs-sourcing-title">Needs sourcing ({desk.needsSourcing.length})</h2>
          <div className="fs-md-stack" data-testid="ops-needs-sourcing">
            {desk.needsSourcing.map((r) => (
              <div key={r.id} className="fs-card fs-md-card" data-testid={`ops-req-${r.id}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{r.ref} · {r.title}</span>
                  <StatusPill status={r.mode} />
                </div>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor={`ops-note-${r.id}`}>Sourcing note</label>
                  <div style={{ display: 'flex', gap: 'var(--fs-space-2)' }}>
                    <input
                      id={`ops-note-${r.id}`}
                      className="fs-input"
                      data-testid={`ops-note-${r.id}`}
                      value={note[r.id] ?? ''}
                      onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                    />
                    <button
                      className="fs-btn fs-btn--sm"
                      data-testid={`ops-note-btn-${r.id}`}
                      disabled={!(note[r.id] ?? '').trim()}
                      onClick={() => void saveNote(r.id)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {desk.openRfqs.length > 0 && (
        <>
          <h2 className="fs-heading-3" data-testid="ops-open-rfqs-title">Open RFQs ({desk.openRfqs.length})</h2>
          <div className="fs-md-stack" data-testid="ops-open-rfqs">
            {desk.openRfqs.map((r) => (
              <div key={r.id} className="fs-card fs-md-card" data-testid={`ops-rfq-${r.id}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{r.ref} · {r.title}</span>
                  {r.deadlineRisk && <StatusPill status="deadline_risk" label="Deadline risk" />}
                </div>
                <p className="fs-body" style={{ margin: 0 }}>{r.invited} invited · {r.quotes} quotes</p>
              </div>
            ))}
          </div>
        </>
      )}

      {desk.uncoveredDemand.length > 0 && (
        <>
          <h2 className="fs-heading-3" data-testid="ops-uncovered-title">Uncovered demand ({desk.uncoveredDemand.length})</h2>
          <div className="fs-md-stack" data-testid="ops-uncovered">
            {desk.uncoveredDemand.map((r) => (
              <div key={r.id} className="fs-card fs-md-card" data-testid={`ops-uncovered-${r.id}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{r.ref} · {r.title}</span>
                  <StatusPill status={r.status} />
                </div>
                <p className="fs-body" style={{ margin: 0 }}>Remaining {r.remaining_qty}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {desk.openClarifications.length > 0 && (
        <>
          <h2 className="fs-heading-3" data-testid="ops-clarifications-title">Open clarifications ({desk.openClarifications.length})</h2>
          <div className="fs-md-stack" data-testid="ops-clarifications">
            {desk.openClarifications.map((c) => (
              <div key={c.id} className="fs-card fs-md-card" data-testid={`ops-clarification-${c.id}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{c.rfq_ref}</span>
                  <span className="fs-body">{fmtDateTime(c.created_at)}</span>
                </div>
                <p className="fs-body" style={{ margin: 0 }}>{c.question}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {desk.assistanceRequested.length > 0 && (
        <>
          <h2 className="fs-heading-3" data-testid="ops-assistance-title">Assistance requested ({desk.assistanceRequested.length})</h2>
          <div className="fs-md-stack" data-testid="ops-assistance">
            {desk.assistanceRequested.map((r) => (
              <div key={r.id} className="fs-card fs-md-card" data-testid={`ops-assist-${r.id}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{r.ref} · {r.title}</span>
                  <StatusPill status={r.status} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
