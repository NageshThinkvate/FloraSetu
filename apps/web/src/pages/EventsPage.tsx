import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createEvent, EventSummary, listEvents } from '../lib/api/demand';

const EVENT_TYPES = ['WEDDING', 'CORPORATE', 'FESTIVAL', 'FUNERAL', 'HOTEL_DAILY', 'OTHER'];

export function EventsPage(): JSX.Element {
  const [items, setItems] = useState<EventSummary[]>([]);
  const [name, setName] = useState('');
  const [eventType, setEventType] = useState(EVENT_TYPES[0]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState('');

  const load = async (): Promise<void> => setItems((await listEvents()).items);
  useEffect(() => {
    void load().catch(() => setError('Could not load events'));
  }, []);

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await createEvent({
        name, eventType,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined
      });
      setName(''); setStartsAt(''); setEndsAt('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  return (
    <main className="app-shell" data-testid="events-page">
      <header className="shell-header"><h1>Events</h1></header>
      <form className="panel inline-form" onSubmit={create} data-testid="event-create-form">
        <input data-testid="event-name" placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
        <select data-testid="event-type" value={eventType} onChange={(e) => setEventType(e.target.value)}>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input data-testid="event-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        <input data-testid="event-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        <button type="submit" data-testid="event-create-btn" disabled={!name.trim()}>Create</button>
      </form>
      {error && <p className="form-error" data-testid="events-error">{error}</p>}
      <section className="module-grid" data-testid="event-list">
        {items.map((ev) => (
          <article key={ev.id} className="module-tile" data-testid={`event-${ev.id}`}>
            <h2>{ev.name}</h2>
            <p>
              <span className="state-chip">{ev.event_type}</span>{' '}
              <span className="state-chip frozen">{ev.status}</span>
            </p>
            <p>{ev.ref} · {ev.ceremonies} ceremonies · {ev.bom_lines} BOM lines
              {ev.starts_at ? ` · ${new Date(ev.starts_at).toLocaleDateString()}` : ''}</p>
            <Link to={`/demand/events/${ev.id}`} data-testid={`open-event-${ev.id}`}>
              <button className="ghost-btn">Open</button>
            </Link>
          </article>
        ))}
        {items.length === 0 && !error && <p className="hint">No events yet.</p>}
      </section>
    </main>
  );
}
