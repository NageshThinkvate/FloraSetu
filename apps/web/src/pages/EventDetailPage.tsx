import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addBomLine, addCeremony, createRequirement, EventDetail, getEvent,
  listMyRfqs, listProducts, listRequirements, listUnits, publishRfq, ProductSummary,
  RequirementSummary, RfqSummary, submitRequirement, UnitOfMeasure
} from '../lib/api/demand';
import { fmtDate } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { InlineAlert } from '../components/InlineAlert';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { SearchableSelect } from '../components/SearchableSelect';

// Event detail (Phase 3 §10): event-first. Ceremonies hold flower requirements with
// delivery milestones; a coverage summary + one "Get offers" action hides all RFQ mechanics.
export function EventDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [addLineFor, setAddLineFor] = useState<string | null>(null);
  const [lineProduct, setLineProduct] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setEvent(await getEvent(id));
  }, [id]);

  useEffect(() => {
    void load().catch(() => setError('Event unavailable'));
    listProducts().then((r) => setProducts(r.items)).catch(() => undefined);
    listUnits().then((r) => setUnits(r.items)).catch(() => undefined);
    listRequirements().then((r) => setRequirements(r.items)).catch(() => undefined);
    listMyRfqs().then((r) => setRfqs(r.items)).catch(() => undefined);
  }, [load]);

  const summary = useMemo(() => {
    if (!event) {
      return null;
    }
    const total = event.bomLines.length;
    const covered = event.bomLines.filter((b) => b.linked).length;
    const eventReq = requirements.find((q) => q.event_ref === event.ref);
    const eventRfqs = rfqs.filter((r) => eventReq && r.requirement_ref === eventReq.ref);
    const offers = eventRfqs.reduce((s, r) => s + (r.quotes ?? 0), 0);
    return {
      coverage: total === 0 ? 0 : Math.round((covered / total) * 100),
      total, covered, offers,
      sourcing: total - covered
    };
  }, [event, rfqs, requirements]);

  const onAddCeremony = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    setBusy(true);
    setError('');
    try {
      await addCeremony(id, {
        name: String(fd.get('name') ?? ''),
        startsAt: fd.get('startsAt') ? new Date(String(fd.get('startsAt'))).toISOString() : undefined,
        venueName: String(fd.get('venue') ?? '') || undefined
      });
      setNotice('Ceremony added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const addLine = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!addLineFor || !lineProduct) {
      return;
    }
    const fd = new FormData(e.target as HTMLFormElement);
    setBusy(true);
    setError('');
    try {
      await addBomLine(id, {
        ceremonyId: addLineFor,
        commodityId: lineProduct,
        quantity: Number(fd.get('quantity')),
        uomId: String(fd.get('uomId')),
        neededAt: fd.get('milestoneAt') ? new Date(String(fd.get('milestoneAt'))).toISOString() : undefined
      });
      setAddLineFor(null);
      setLineProduct(null);
      setNotice('Flower requirement added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  // One action — create the sourcing requirement, submit it and start collecting offers.
  // RFQ mechanics stay invisible to the buyer (§10).
  const getOffers = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const destination = String(fd.get('destination') ?? '').trim();
    if (!destination) {
      setError('Add a delivery location so suppliers can commit to delivery.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const req = await createRequirement({
        mode: 'EVENT',
        title: `${event?.name ?? 'Event'} flowers`,
        eventId: id,
        lines: (event?.bomLines ?? []).filter((b) => !b.linked).map((b) => ({
          commodityId: b.commodity_id,
          quantity: Number(b.quantity),
          uomId: b.uom_id,
          neededAt: b.needed_at ?? event?.starts_at ?? new Date().toISOString(),
          deliveryDestination: destination
        }))
      });
      await submitRequirement(req.id, crypto.randomUUID());
      await publishRfq(req.id, {}, crypto.randomUUID());
      setNotice("We're collecting offers for this event — we'll notify you as they arrive.");
      await load();
      setRequirements((await listRequirements()).items);
      setRfqs((await listMyRfqs()).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sourcing');
    } finally {
      setBusy(false);
    }
  };

  if (error && !event) {
    return <InlineAlert variant="error" testId="event-error">{error}</InlineAlert>;
  }
  if (!event) {
    return <SkeletonLoader variant="card" count={2} testId="event-loading" />;
  }

  const eventReq = requirements.find((q) => q.event_ref === event.ref);
  const unlinked = event.bomLines.filter((b) => !b.linked);

  return (
    <div data-testid="event-detail">
      <PageHeader overline={event.event_type.toLowerCase()} title={event.name} testId="event-header" />
      <p className="fs-body fs-text-secondary" data-testid="event-dates">
        {fmtDate(event.starts_at)} → {fmtDate(event.ends_at)}
      </p>
      {notice && <InlineAlert variant="success" testId="event-notice">{notice}</InlineAlert>}
      {error && <InlineAlert variant="error" testId="event-error-inline">{error}</InlineAlert>}

      {summary && summary.total > 0 && (
        <div className="fs-card fs-md-card" data-testid="event-summary" style={{ marginBottom: 'var(--fs-space-4)' }}>
          <div className="fs-md-card__fields">
            <div><div className="fs-md-card__field-label">Supply covered</div>
              <div className="fs-md-card__field-value" data-testid="event-coverage">{summary.coverage}%</div></div>
            <div><div className="fs-md-card__field-label">Offers received</div>
              <div className="fs-md-card__field-value" data-testid="event-offers">{summary.offers}</div></div>
            <div><div className="fs-md-card__field-label">Still sourcing</div>
              <div className="fs-md-card__field-value" data-testid="event-sourcing">{summary.sourcing} flower{summary.sourcing === 1 ? '' : 's'}</div></div>
          </div>
        </div>
      )}

      {event.ceremonies.map((c) => (
        <section key={c.id} className="fs-card fs-md-card" style={{ marginBottom: 'var(--fs-space-4)' }} data-testid={`ceremony-${c.id.slice(0, 8)}`}>
          <div className="fs-task-card__top">
            <h2 className="fs-h3" style={{ margin: 0 }}>{c.name}</h2>
            {c.sort_order !== null && <span className="fs-caption fs-text-secondary">Ceremony {c.sort_order}</span>}
          </div>
          <p className="fs-caption fs-text-secondary">
            {c.starts_at ? fmtDate(c.starts_at) : 'date open'}{c.venue_name ? ` · ${c.venue_name}` : ''}
          </p>
          <ul style={{ listStyle: 'none', margin: 'var(--fs-space-3) 0', padding: 0, display: 'grid', gap: 'var(--fs-space-2)' }}>
            {event.bomLines.filter((b) => b.ceremony_id === c.id).map((b) => (
              <li key={b.id} className="fs-body" data-testid={`event-line-${b.id.slice(0, 8)}`}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--fs-space-3)', alignItems: 'center' }}>
                <span>
                  {products.find((p) => p.id === b.commodity_id)?.name ?? 'Flower'} — {b.quantity}
                  {b.needed_at ? ` · deliver ${fmtDate(b.needed_at)}` : ''}
                </span>
                <StatusPill status={b.linked ? 'SOURCING' : 'DRAFT'} label={b.linked ? 'Sourcing' : 'Not sourcing yet'}
                  testId={`event-line-status-${b.id.slice(0, 8)}`} />
              </li>
            ))}
          </ul>
          {addLineFor === c.id ? (
            <form onSubmit={addLine} className="fs-md-stack">
              <SearchableSelect
                label="Flower"
                options={products.map((p) => ({ value: p.id, label: p.name, hint: p.commercial_name ?? p.ref }))}
                value={lineProduct}
                onChange={setLineProduct}
                placeholder="Search flowers"
                testId="event-line-flower"
              />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--fs-space-3)' }}>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor={`line-qty-${c.id}`}>Quantity</label>
                  <input id={`line-qty-${c.id}`} name="quantity" type="number" min="0.01" step="any" className="fs-input fs-num" data-testid="event-line-qty" required />
                </div>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor={`line-uom-${c.id}`}>Unit</label>
                  <select id={`line-uom-${c.id}`} name="uomId" className="fs-select" data-testid="event-line-uom" required>
                    <option value="">Select…</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                  </select>
                </div>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor={`line-ms-${c.id}`}>Delivery milestone</label>
                  <input id={`line-ms-${c.id}`} name="milestoneAt" type="datetime-local" className="fs-input" data-testid="event-line-milestone" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--fs-space-2)' }}>
                <button type="submit" className="fs-btn fs-btn--sm" data-testid="event-line-add" disabled={busy || !lineProduct}>Add flower</button>
                <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" onClick={() => setAddLineFor(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid={`event-add-line-${c.id.slice(0, 8)}`}
              onClick={() => setAddLineFor(c.id)}>+ Add flower requirement</button>
          )}
        </section>
      ))}

      <section className="fs-card fs-md-card" style={{ marginBottom: 'var(--fs-space-4)' }}>
        <h2 className="fs-h3" style={{ marginTop: 0 }}>Add a ceremony</h2>
        <form onSubmit={onAddCeremony} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--fs-space-3)' }}>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="cer-name">Name</label>
            <input id="cer-name" name="name" className="fs-input" data-testid="ceremony-name" placeholder="Mehendi" required />
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="cer-start">Starts</label>
            <input id="cer-start" name="startsAt" type="datetime-local" className="fs-input" data-testid="ceremony-starts" />
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="cer-venue">Venue</label>
            <input id="cer-venue" name="venue" className="fs-input" data-testid="ceremony-venue" />
          </div>
          <div className="fs-field" style={{ alignSelf: 'end' }}>
            <button type="submit" className="fs-btn fs-btn--sm" data-testid="ceremony-add" disabled={busy}>Add ceremony</button>
          </div>
        </form>
      </section>

      {unlinked.length > 0 && !requirements.some((q) => q.event_ref === event.ref) && (
        <section className="fs-card fs-md-card" data-testid="event-get-offers">
          <h2 className="fs-h3" style={{ marginTop: 0 }}>Get offers</h2>
          <form onSubmit={getOffers} className="fs-md-stack">
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="event-dest">Delivery location</label>
              <input id="event-dest" name="destination" className="fs-input" data-testid="event-destination"
                placeholder="Venue / city for delivery" />
            </div>
            <button type="submit" className="fs-btn" data-testid="event-get-offers-btn" disabled={busy}>
              {busy ? 'Starting sourcing…' : 'Get offers'}
            </button>
          </form>
        </section>
      )}
      {eventReq && (
        <p className="fs-body" style={{ marginTop: 'var(--fs-space-4)' }}>
          <Link to={`/buyer/requirements/${eventReq.id}`} data-testid="event-requirement-link">
            View sourcing status →
          </Link>
        </p>
      )}

      <p style={{ marginTop: 'var(--fs-space-5)' }}><Link to="/buyer/events">← All events</Link></p>
    </div>
  );
}
