import { FormEvent, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api/client';

interface Capability {
  id: string;
  variety_id: string;
  variety: string;
  commodity: string;
  status: string;
  notes: string | null;
}

export function CapabilitiesPage(): JSX.Element {
  const [items, setItems] = useState<Capability[]>([]);
  const [varietyId, setVarietyId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async (): Promise<void> => {
    setItems((await apiGet<{ items: Capability[] }>('/catalog/capabilities')).items);
  };

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, []);

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await apiPost('/catalog/capabilities', { varietyId, notes: notes || undefined });
      setVarietyId('');
      setNotes('');
      setNotice('Capability added');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <main className="app-shell" data-testid="capabilities-page">
      <header className="shell-header"><h1>Products we handle</h1></header>
      <section className="panel">
        <ul className="plain-list" data-testid="capabilities-list">
          {items.map((c) => (
            <li key={c.id} data-testid={`capability-${c.id}`}>
              {c.commodity} — {c.variety} ({c.status.toLowerCase()}) {c.notes ?? ''}
            </li>
          ))}
          {items.length === 0 && <li>No capabilities recorded yet.</li>}
        </ul>
        <form className="inline-form" onSubmit={add} data-testid="capability-form">
          <input data-testid="capability-variety" placeholder="Variety UUID" value={varietyId} onChange={(e) => setVarietyId(e.target.value)} required />
          <input data-testid="capability-notes" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="submit" data-testid="capability-add">Add</button>
        </form>
        {notice && <p className="form-ok" data-testid="capability-notice">{notice}</p>}
        {error && <p className="form-error" data-testid="capability-error">{error}</p>}
      </section>
    </main>
  );
}
