import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addBomLine, addCeremony, createRequirement, EventDetail, getEvent,
  listProducts, listUnits, ProductSummary, UnitOfMeasure
} from '../lib/api/demand';

export function EventDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ceremonyName, setCeremonyName] = useState('');
  const [bom, setBom] = useState({ ceremonyId: '', commodityId: '', quantity: '', uomId: '', deliveryMilestone: '' });
  const [destination, setDestination] = useState('');
  const [requirementId, setRequirementId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => setEvent(await getEvent(id)), [id]);
  useEffect(() => {
    void load().catch(() => setError('Event not found'));
    listProducts().then((r) => setProducts(r.items)).catch(() => undefined);
    listUnits().then((r) => setUnits(r.items)).catch(() => undefined);
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  if (!event) {
    return <main className="app-shell" data-testid="event-loading"><p className="hint">Loading…</p></main>;
  }

  const createReq = async (): Promise<void> => {
    if (!destination.trim()) {
      setError('Delivery destination required to source the BOM.');
      return;
    }
    await run(async () => {
      const req = await createRequirement({
        mode: 'EVENT',
        title: `${event.name} — flower sourcing`,
        eventId: event.id,
        lines: event.bomLines.filter((b) => !b.linked).map((b) => ({
          bomLineId: b.id,
          commodityId: b.commodity_id,
          varietyId: b.variety_id ?? undefined,
          quantity: Number(b.quantity),
          uomId: b.uom_id,
          neededAt: b.needed_at ?? event.starts_at ?? new Date(Date.now() + 7 * 24 * 3600e3).toISOString(),
          deliveryDestination: destination.trim()
        }))
      });
      setRequirementId(req.id);
    }, 'Requirement drafted from BOM — open it to submit for sourcing.');
  };

  return (
    <main className="app-shell" data-testid="event-detail">
      <header className="shell-header">
        <h1>{event.name}</h1>
        <span className="state-chip frozen" data-testid="event-status">{event.status}</span>
      </header>
      <p className="hint">{event.ref} · {event.event_type}{event.venue_name ? ` · ${event.venue_name}` : ''}</p>
      {error && <p className="form-error" data-testid="event-error">{error}</p>}
      {notice && <p className="form-ok" data-testid="event-notice">{notice}</p>}

      <section className="panel" data-testid="ceremonies-panel">
        <h2>Ceremonies</h2>
        <ul className="plain-list">
          {event.ceremonies.map((c) => (
            <li key={c.id} data-testid={`ceremony-${c.id}`}>
              {c.sort_order}. {c.name}{c.venue_name ? ` · ${c.venue_name}` : ''}
              {c.starts_at ? ` · ${new Date(c.starts_at).toLocaleString()}` : ''}
            </li>
          ))}
        </ul>
        <form className="inline-form" data-testid="ceremony-form" onSubmit={(e) => {
          e.preventDefault();
          void run(() => addCeremony(event.id, { name: ceremonyName, sortOrder: event.ceremonies.length + 1 }), 'Ceremony added.');
          setCeremonyName('');
        }}>
          <input data-testid="ceremony-name" placeholder="Ceremony name (e.g. Haldi)" value={ceremonyName}
            onChange={(e) => setCeremonyName(e.target.value)} />
          <button type="submit" data-testid="ceremony-add-btn" disabled={!ceremonyName.trim()}>Add</button>
        </form>
      </section>

      <section className="panel" data-testid="bom-panel">
        <h2>Bill of materials</h2>
        <ul className="plain-list">
          {event.bomLines.map((b) => (
            <li key={b.id} data-testid={`bom-${b.id}`}>
              <span>{products.find((p) => p.id === b.commodity_id)?.name ?? b.commodity_id}</span>
              <span>{b.quantity} {units.find((u) => u.id === b.uom_id)?.code ?? ''}</span>
              <span className="state-chip">{b.sourcing_status}</span>
              {b.linked && <span className="state-chip frozen">linked</span>}
            </li>
          ))}
        </ul>
        <form className="inline-form" data-testid="bom-form" onSubmit={(e) => {
          e.preventDefault();
          void run(() => addBomLine(event.id, {
            ceremonyId: bom.ceremonyId || undefined,
            commodityId: bom.commodityId,
            quantity: Number(bom.quantity),
            uomId: bom.uomId,
            deliveryMilestone: bom.deliveryMilestone || undefined
          }), 'BOM line added.');
        }}>
          <select data-testid="bom-ceremony" value={bom.ceremonyId}
            onChange={(e) => setBom({ ...bom, ceremonyId: e.target.value })}>
            <option value="">Whole event</option>
            {event.ceremonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select data-testid="bom-product" value={bom.commodityId}
            onChange={(e) => setBom({ ...bom, commodityId: e.target.value })}>
            <option value="">Product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input data-testid="bom-qty" type="number" min="1" step="any" placeholder="Qty" value={bom.quantity}
            onChange={(e) => setBom({ ...bom, quantity: e.target.value })} />
          <select data-testid="bom-uom" value={bom.uomId} onChange={(e) => setBom({ ...bom, uomId: e.target.value })}>
            <option value="">Unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
          </select>
          <input data-testid="bom-milestone" placeholder="Milestone (e.g. DAY_BEFORE)" value={bom.deliveryMilestone}
            onChange={(e) => setBom({ ...bom, deliveryMilestone: e.target.value })} />
          <button type="submit" data-testid="bom-add-btn"
            disabled={!bom.commodityId || !bom.quantity || !bom.uomId}>Add line</button>
        </form>
        {event.bomLines.some((b) => !b.linked) && (
          <div className="inline-form" style={{ marginTop: 16 }}>
            <input data-testid="bom-destination" placeholder="Delivery destination" value={destination}
              onChange={(e) => setDestination(e.target.value)} />
            <button className="ghost-btn" data-testid="bom-create-requirement" onClick={() => void createReq()}>
              Draft requirement from BOM
            </button>
            {requirementId && (
              <Link to={`/demand/requirements/${requirementId}`} data-testid="bom-open-requirement">
                <button>Open requirement</button>
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
