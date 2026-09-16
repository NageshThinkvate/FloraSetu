import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createEvent, listEvents, EventSummary } from '../lib/api/demand';
import { fmtDate } from '../lib/api/fulfilment';

const EVENT_TYPES = ['WEDDING', 'CORPORATE', 'FESTIVAL', 'PUJA', 'FUNERAL', 'OTHER'];
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';
import { SkeletonLoader } from '../components/SkeletonLoader';

// Events (Phase 3 §10): event-first — the buyer thinks in events and ceremonies,
// never in RFQs. Coverage and sourcing status surface on the event itself.
export function EventsPage(): JSX.Element {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setEvents((await listEvents()).items);
  }, []);
  useEffect(() => {
    void load().catch(() => setEvents([]));
  }, [load]);

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    setBusy(true);
    setError('');
    try {
      await createEvent({
        name: String(fd.get('name') ?? ''),
        eventType: String(fd.get('eventType') ?? 'OTHER'),
        startAt: new Date(String(fd.get('startAt'))).toISOString(),
        endAt: new Date(String(fd.get('endAt'))).toISOString()
      });
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the event');
    } finally {
      setBusy(false);
    }
  };

  if (events === null) {
    return <SkeletonLoader variant="card" count={2} testId="events-loading" />;
  }

  return (
    <div data-testid="events-page">
      <PageHeader
        overline="Events"
        title="Your events"
        testId="events-header"
        actions={<button className="fs-btn" data-testid="event-new-btn" onClick={() => setCreating((v) => !v)}>New event</button>}
      />
      {error && <InlineAlert variant="error" testId="events-error">{error}</InlineAlert>}

      {creating && (
        <form onSubmit={create} className="fs-card fs-md-card" data-testid="event-form" style={{ marginBottom: 'var(--fs-space-4)' }}>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="ev-name">Event name</label>
            <input id="ev-name" name="name" className="fs-input" data-testid="event-name" placeholder="Arun & Lakshmi Wedding" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--fs-space-3)' }}>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="ev-type">Type</label>
              <select id="ev-type" name="eventType" className="fs-select" data-testid="event-type">
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="ev-start">Starts</label>
              <input id="ev-start" name="startAt" type="datetime-local" className="fs-input" data-testid="event-start" required />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="ev-end">Ends</label>
              <input id="ev-end" name="endAt" type="datetime-local" className="fs-input" data-testid="event-end" required />
            </div>
          </div>
          <button type="submit" className="fs-btn" data-testid="event-create" disabled={busy} style={{ marginTop: 'var(--fs-space-3)' }}>
            {busy ? 'Creating…' : 'Create event'}
          </button>
        </form>
      )}

      {events.length === 0 && !creating && (
        <EmptyState
          title="No events yet"
          hint="Start with the event — ceremonies, milestones and flower lists. FloraSetu organizes the sourcing behind the scenes."
          actionLabel="Plan an event"
          onAction={() => setCreating(true)}
          testId="events-empty"
        />
      )}
      <div className="fs-md-stack">
        {events.map((e) => (
          <TaskCard
            key={e.id}
            testId={`event-card-${e.id.slice(0, 8)}`}
            title={e.name}
            meta={[`${fmtDate(e.starts_at)} → ${fmtDate(e.ends_at)}`, e.event_type.toLowerCase()]}
            status={e.status}
            footer={<Link className="fs-btn fs-btn--sm" data-testid={`event-open-${e.id.slice(0, 8)}`} to={`/buyer/events/${e.id}`}>Open event</Link>}
          />
        ))}
      </div>
    </div>
  );
}
