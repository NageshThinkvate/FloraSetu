import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  acceptJob, arrivedAtDelivery, arrivedAtPickup, assignDriver, confirmPickup, deliverJob,
  EligibleDriver, getJob, JobDetail, listEligibleDrivers, markInTransit, reportJobException,
  unassignDriver, uploadMedia
} from '../lib/api/logistics';
import { MODE_LABEL } from './PartnerJobsPage';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';
import { useToast } from '../lib/toast';

const ROAD_MODES = new Set(['NORMAL_ROAD', 'INSULATED_ROAD', 'REEFER_ROAD', 'LOCAL_PICKUP', 'SPECIAL_EXPRESS']);

const EXCEPTION_TYPES: [string, string][] = [
  ['PICKUP_DELAY', 'Pickup delay'],
  ['VEHICLE_BREAKDOWN', 'Vehicle breakdown'],
  ['MISSED_DEPARTURE', 'Missed departure'],
  ['PARCEL_REJECTED', 'Parcel refused'],
  ['DAMAGE_OBSERVED', 'Damage observed'],
  ['TEMPERATURE_CONCERN', 'Temperature concern'],
  ['ADDRESS_ISSUE', 'Delivery issue'],
  ['RECIPIENT_UNAVAILABLE', 'Recipient unavailable'],
  ['OTHER', 'Other']
];

const EVENT_LABEL: Record<string, string> = {
  DRIVER_ASSIGNED: 'Driver assigned',
  DRIVER_REASSIGNED: 'Driver changed',
  DRIVER_UNASSIGNED: 'Driver unassigned',
  JOB_ACCEPTED: 'Job accepted',
  ARRIVED_AT_PICKUP: 'Arrived at pickup',
  PICKUP_CONFIRMED: 'Pickup confirmed',
  IN_TRANSIT: 'In transit',
  ARRIVED_AT_DELIVERY: 'Arrived at delivery',
  DELIVERY_CONFIRMED: 'Delivery confirmed',
  POD_SUBMITTED: 'Proof of delivery submitted',
  EXCEPTION_REPORTED: 'Issue reported',
  EXCEPTION_RESOLVED: 'Issue resolved'
};

const PURPOSE_LABEL: Record<string, string> = {
  PICKUP_EVIDENCE: 'Pickup evidence',
  DELIVERY_PHOTO: 'Delivery photo',
  POD: 'Proof of delivery',
  EXCEPTION_EVIDENCE: 'Issue evidence',
  PARCEL_RECEIPT: 'Parcel receipt'
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const fmtDateTime = (v: string | null): string =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

function Field({ label, value, testId }: { label: string; value: string | null | undefined; testId: string }): JSX.Element {
  return (
    <div>
      <div className="fs-md-card__field-label">{label}</div>
      <div className="fs-md-card__field-value" data-testid={testId}>{value ?? '—'}</div>
    </div>
  );
}

export function PartnerJobDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const { toast } = useToast();
  const { me, activeOrgId } = useAuth();
  const isManager = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles.includes('ORG_ADMIN') ?? false;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<EligibleDriver[] | null>(null);
  const [driverId, setDriverId] = useState('');
  const [vehicleRef, setVehicleRef] = useState('');
  const [assignReason, setAssignReason] = useState('');
  const [awbRef, setAwbRef] = useState('');
  const [transportRef, setTransportRef] = useState('');
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);
  const [deliveredQty, setDeliveredQty] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [podRef, setPodRef] = useState('');
  const [podNotes, setPodNotes] = useState('');
  const [podPhoto, setPodPhoto] = useState<File | null>(null);
  const [sigPhoto, setSigPhoto] = useState<File | null>(null);
  const [exType, setExType] = useState(EXCEPTION_TYPES[0][0]);
  const [exNote, setExNote] = useState('');
  const [exPhoto, setExPhoto] = useState<File | null>(null);

  const load = useCallback((): void => {
    getJob(id)
      .then(setJob)
      .catch(() => setError("We couldn't load this job. It may belong to another organization or a different driver."));
  }, [id]);
  useEffect(load, [load]);

  const isRoad = ROAD_MODES.has(job?.mode ?? '');
  const delivered = job?.status === 'DELIVERED';

  useEffect(() => {
    if (isManager && job && isRoad && !delivered) {
      listEligibleDrivers()
        .then((r) => setMembers(r.items))
        .catch(() => setMembers([]));
    }
  }, [isManager, job, isRoad, delivered]);

  const act = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await fn();
      toast(message);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That action could not be completed. Check the job state and try again.');
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (f: File | null): Promise<string | undefined> =>
    f ? (await uploadMedia(f.type || 'image/jpeg', await toBase64(f))).id : undefined;

  if (error && !job) {
    return <InlineAlert variant="error" title="Job unavailable" testId="job-error">{error}</InlineAlert>;
  }
  if (!job) {
    return <SkeletonLoader variant="card" count={3} testId="job-loading" />;
  }

  const pickedUp = job.events.some((e) => e.event_type === 'PICKUP_CONFIRMED');
  const canAccept = !job.job_accepted_at && !delivered;
  const canArrivePickup = !!job.job_accepted_at && !job.arrived_pickup_at && job.status === 'PLANNED';
  const canPickup = !!job.job_accepted_at && !pickedUp && job.status === 'PLANNED';
  const canTransit = pickedUp && job.status === 'PLANNED';
  const canArriveDelivery = job.status === 'IN_TRANSIT' && !job.arrived_delivery_at;
  const canDeliver = job.status === 'IN_TRANSIT';

  return (
    <div data-testid="partner-job-detail">
      <PageHeader
        overline={`${MODE_LABEL[job.mode ?? ''] ?? job.mode ?? 'Transport'} job`}
        title={job.ref}
        testId="job-header"
      />
      {error && <InlineAlert variant="error" testId="job-action-error">{error}</InlineAlert>}

      <div className="fs-card fs-md-card" data-testid="job-summary">
        <div className="fs-task-card__top">
          <span className="fs-md-card__primary">{job.order_ref ? `Order ${job.order_ref}` : 'Logistics job'}</span>
          <StatusPill status={job.status} testId="job-status" />
        </div>
        <div className="fs-md-card__fields">
          <Field label="Packages / cartons" value={job.package_count != null ? String(job.package_count) : null} testId="job-packages" />
          <Field
            label="Temperature control"
            value={job.temp_controlled ? 'Required — maintain cold chain' : 'Not required'}
            testId="job-temp"
          />
          <Field label="Handling instruction" value={job.handling_note} testId="job-handling" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--fs-space-4)', marginTop: 'var(--fs-space-4)' }}>
        <div className="fs-card fs-md-card" data-testid="job-pickup-card">
          <span className="fs-h4">Pickup</span>
          <div className="fs-md-card__fields">
            <Field label="Company" value={job.pickup_company} testId="job-pickup-company" />
            <Field label="Address" value={job.origin_text} testId="job-pickup-address" />
            {job.origin_terminal && <Field label="Terminal" value={job.origin_terminal} testId="job-pickup-terminal" />}
            <Field label="Pickup deadline" value={fmtDateTime(job.pickup_at)} testId="job-pickup-deadline" />
          </div>
        </div>
        <div className="fs-card fs-md-card" data-testid="job-delivery-card">
          <span className="fs-h4">Delivery</span>
          <div className="fs-md-card__fields">
            <Field label="Company" value={job.delivery_company} testId="job-delivery-company" />
            <Field label="Address" value={job.destination_text} testId="job-delivery-address" />
            {job.destination_terminal && <Field label="Terminal" value={job.destination_terminal} testId="job-delivery-terminal" />}
            <Field label="Expected delivery" value={fmtDateTime(job.eta)} testId="job-delivery-eta" />
          </div>
        </div>
      </div>

      <div className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="job-transport-card">
        <span className="fs-h4">Transport</span>
        {isRoad ? (
          <>
            <div className="fs-md-card__fields">
              <Field label="Assigned driver" value={job.driver_name ?? 'Driver not assigned'} testId="job-driver-name" />
              <Field label="Vehicle" value={job.vehicle_ref} testId="job-vehicle" />
            </div>
            {isManager && !delivered && (
              <div data-testid="job-assign-panel" style={{ marginTop: 'var(--fs-space-3)' }}>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="job-driver-select">
                    {job.driver_user_id ? 'Reassign driver' : 'Assign driver'}
                  </label>
                  <select
                    id="job-driver-select"
                    className="fs-select"
                    data-testid="job-assign-select"
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                  >
                    <option value="">Select a team member…</option>
                    {(members ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>{m.displayName}</option>
                    ))}
                  </select>
                </div>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="job-vehicle-input">Vehicle number (optional)</label>
                  <input
                    id="job-vehicle-input"
                    className="fs-input"
                    data-testid="job-vehicle-input"
                    value={vehicleRef}
                    onChange={(e) => setVehicleRef(e.target.value)}
                  />
                </div>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="job-assign-reason">Reason (optional)</label>
                  <input
                    id="job-assign-reason"
                    className="fs-input"
                    data-testid="job-assign-reason"
                    value={assignReason}
                    onChange={(e) => setAssignReason(e.target.value)}
                  />
                </div>
                <button
                  className="fs-btn"
                  disabled={busy || !driverId}
                  data-testid="job-assign-btn"
                  onClick={() => void act(
                    () => assignDriver(id, { driverUserId: driverId, vehicleRef: vehicleRef || undefined, reason: assignReason || undefined }),
                    'Driver assigned'
                  )}
                >
                  {job.driver_user_id ? 'Reassign driver' : 'Assign driver'}
                </button>
                {job.driver_user_id && (
                  <button
                    className="fs-btn fs-btn--ghost"
                    disabled={busy}
                    data-testid="job-unassign-btn"
                    onClick={() => void act(() => unassignDriver(id, { reason: assignReason || undefined }), 'Driver unassigned')}
                  >
                    Unassign driver
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="fs-md-card__fields" data-testid="job-carrier-panel">
            <Field label="Operator / carrier" value={job.carrier_name} testId="job-carrier" />
            <Field label="Booking / transport reference" value={job.transport_ref} testId="job-transport-ref" />
            <Field label="Parcel / AWB reference" value={job.parcel_awb_ref} testId="job-awb" />
            <Field label="Departure (ETD)" value={fmtDateTime(job.etd)} testId="job-etd" />
            <Field label="Arrival (ETA)" value={fmtDateTime(job.eta)} testId="job-eta" />
            <p className="fs-body" style={{ margin: 0 }} data-testid="job-no-driver-note">
              No driver assignment needed for this transport mode — record references and milestones below.
            </p>
          </div>
        )}
      </div>

      <div className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="job-actions">
        <span className="fs-h4">Execution</span>
        <div className="fs-md-stack">
          {canAccept && (
            <button className="fs-btn" disabled={busy} data-testid="job-accept-btn"
              onClick={() => void act(() => acceptJob(id), 'Job accepted')}>
              Accept job
            </button>
          )}
          {canArrivePickup && (
            <button className="fs-btn" disabled={busy} data-testid="job-arrived-pickup-btn"
              onClick={() => void act(() => arrivedAtPickup(id), 'Arrived at pickup')}>
              Arrived at pickup
            </button>
          )}
          {canPickup && (
            <div data-testid="job-pickup-panel">
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-awb-input">Parcel / AWB / receipt reference (optional)</label>
                <input id="job-awb-input" className="fs-input" data-testid="job-awb-input" value={awbRef} onChange={(e) => setAwbRef(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-tref-input">Vehicle / transport reference (optional)</label>
                <input id="job-tref-input" className="fs-input" data-testid="job-tref-input" value={transportRef} onChange={(e) => setTransportRef(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-pickup-photo">Pickup photo evidence (optional)</label>
                <input
                  id="job-pickup-photo"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="fs-input"
                  data-testid="job-pickup-photo"
                  onChange={(e) => setPickupPhoto(e.target.files?.[0] ?? null)}
                />
              </div>
              <button className="fs-btn" disabled={busy} data-testid="job-pickup-btn" onClick={() => void act(async () => {
                const mediaObjectId = await uploadFile(pickupPhoto);
                await confirmPickup(id, {
                  awbRef: awbRef || undefined,
                  transportRef: transportRef || undefined,
                  mediaObjectId
                });
              }, 'Pickup confirmed')}>
                Confirm pickup
              </button>
            </div>
          )}
          {canTransit && (
            <button className="fs-btn" disabled={busy} data-testid="job-transit-btn"
              onClick={() => void act(() => markInTransit(id), 'Marked in transit')}>
              Start transit
            </button>
          )}
          {canArriveDelivery && (
            <button className="fs-btn" disabled={busy} data-testid="job-arrived-delivery-btn"
              onClick={() => void act(() => arrivedAtDelivery(id), 'Arrived at delivery')}>
              Arrived at delivery
            </button>
          )}
          {canDeliver && (
            <div data-testid="job-pod-form">
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-qty-input">Packages / quantity received *</label>
                <input id="job-qty-input" className="fs-input fs-num" inputMode="numeric" data-testid="job-qty-input" value={deliveredQty} onChange={(e) => setDeliveredQty(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-receiver-input">Received by (name)</label>
                <input id="job-receiver-input" className="fs-input" data-testid="job-receiver-input" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-pod-ref">POD / receipt reference</label>
                <input id="job-pod-ref" className="fs-input" data-testid="job-pod-ref" value={podRef} onChange={(e) => setPodRef(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-pod-photo">Delivery photo (optional)</label>
                <input id="job-pod-photo" type="file" accept="image/*" capture="environment" className="fs-input" data-testid="job-pod-photo" onChange={(e) => setPodPhoto(e.target.files?.[0] ?? null)} />
              </div>
              {isRoad && (
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="job-signature-photo">Signature photo (optional)</label>
                  <input id="job-signature-photo" type="file" accept="image/*" className="fs-input" data-testid="job-signature-photo" onChange={(e) => setSigPhoto(e.target.files?.[0] ?? null)} />
                </div>
              )}
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="job-pod-notes">Notes (optional)</label>
                <input id="job-pod-notes" className="fs-input" data-testid="job-pod-notes" value={podNotes} onChange={(e) => setPodNotes(e.target.value)} />
              </div>
              <button
                className="fs-btn"
                disabled={busy || !deliveredQty}
                data-testid="job-deliver-btn"
                onClick={() => void act(async () => {
                  const mediaObjectId = await uploadFile(podPhoto);
                  const signatureMediaObjectId = await uploadFile(sigPhoto);
                  await deliverJob(id, {
                    deliveredQty: Number(deliveredQty),
                    receiverName: receiverName || undefined,
                    podRef: podRef || undefined,
                    notes: podNotes || undefined,
                    mediaObjectId,
                    signatureMediaObjectId
                  });
                }, 'Delivery recorded — proof of delivery saved')}
              >
                Confirm delivery + submit POD
              </button>
            </div>
          )}
          {delivered && job.pods.length > 0 && (
            <div data-testid="job-pod-card">
              <span className="fs-h4">Proof of delivery</span>
              <div className="fs-md-card__fields">
                <Field label="Received by" value={job.pods[0].receiver_name} testId="job-pod-receiver" />
                <Field label="Quantity" value={job.pods[0].delivered_qty} testId="job-pod-qty" />
                <Field label="POD reference" value={job.pods[0].pod_ref} testId="job-pod-ref-view" />
                <Field label="Delivered at" value={fmtDateTime(job.pods[0].created_at)} testId="job-pod-time" />
                {job.pods[0].notes && <Field label="Notes" value={job.pods[0].notes} testId="job-pod-notes-view" />}
              </div>
              {job.pods[0].url && (
                <a className="fs-btn fs-btn--ghost fs-btn--sm" href={job.pods[0].url} target="_blank" rel="noreferrer" data-testid="job-pod-photo-link">
                  View delivery photo
                </a>
              )}
              {job.pods[0].signature_url && (
                <a className="fs-btn fs-btn--ghost fs-btn--sm" href={job.pods[0].signature_url} target="_blank" rel="noreferrer" data-testid="job-pod-signature-link">
                  View signature
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="job-exception-panel">
        <span className="fs-h4">Report an issue</span>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="job-ex-type">Type</label>
          <select id="job-ex-type" className="fs-select" data-testid="job-ex-type" value={exType} onChange={(e) => setExType(e.target.value)}>
            {EXCEPTION_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="job-ex-note">Note (optional)</label>
          <input id="job-ex-note" className="fs-input" data-testid="job-ex-note" value={exNote} onChange={(e) => setExNote(e.target.value)} />
        </div>
        <div className="fs-field">
          <label className="fs-field__label" htmlFor="job-ex-photo">Photo evidence (optional)</label>
          <input id="job-ex-photo" type="file" accept="image/*" capture="environment" className="fs-input" data-testid="job-ex-photo" onChange={(e) => setExPhoto(e.target.files?.[0] ?? null)} />
        </div>
        <button
          className="fs-btn fs-btn--secondary"
          disabled={busy || delivered}
          data-testid="job-exception-btn"
          onClick={() => void act(async () => {
            const mediaObjectId = await uploadFile(exPhoto);
            await reportJobException(id, { type: exType, note: exNote || undefined, mediaObjectId });
            setExNote('');
            setExPhoto(null);
          }, 'Issue reported to FloraSetu operations')}
        >
          Report to operations
        </button>
        {job.exceptions.length > 0 && (
          <div data-testid="job-exceptions-list" style={{ marginTop: 'var(--fs-space-3)' }}>
            {job.exceptions.map((e) => (
              <p key={e.id} className="fs-body" style={{ margin: 0 }} data-testid={`job-exception-${e.id.slice(0, 8)}`}>
                {EXCEPTION_TYPES.find(([v]) => v === e.type)?.[1] ?? e.type ?? 'Issue'} · {e.status.toLowerCase()}
                {e.note ? ` · ${e.note}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>

      {job.media.length > 0 && (
        <div className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="job-evidence">
          <span className="fs-h4">Evidence</span>
          <div className="fs-md-stack">
            {job.media.map((m) => (
              <a key={m.id} href={m.url ?? '#'} target="_blank" rel="noreferrer" className="fs-body" data-testid={`job-evidence-${m.id.slice(0, 8)}`}>
                {PURPOSE_LABEL[m.purpose] ?? m.purpose} · {fmtDateTime(m.captured_at)}
              </a>
            ))}
          </div>
        </div>
      )}

      {job.events.length > 0 && (
        <div className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="job-timeline">
          <span className="fs-h4">Timeline</span>
          <div className="fs-md-stack">
            {job.events.map((e) => (
              <p key={e.id} className="fs-body" style={{ margin: 0 }} data-testid={`job-event-${e.event_type.toLowerCase()}`}>
                {EVENT_LABEL[e.event_type] ?? e.event_type} · {fmtDateTime(e.occurred_at)}
                {e.actor_name ? ` · ${e.actor_name}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
