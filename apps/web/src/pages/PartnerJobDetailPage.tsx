import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  acceptJob, confirmPickup, deliverJob, getJob, JobDetail, markInTransit, reportJobException, uploadMedia
} from '../lib/api/logistics';
import { MODE_LABEL } from './PartnerJobsPage';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';
import { useToast } from '../lib/toast';

const EXCEPTION_TYPES: [string, string][] = [
  ['PICKUP_DELAY', 'Pickup delay'],
  ['VEHICLE_BREAKDOWN', 'Vehicle breakdown'],
  ['MISSED_DEPARTURE', 'Missed bus/train/flight'],
  ['PARCEL_REJECTED', 'Parcel rejected'],
  ['DAMAGE_OBSERVED', 'Damage observed'],
  ['TEMPERATURE_CONCERN', 'Temperature concern'],
  ['ADDRESS_ISSUE', 'Delivery address issue'],
  ['RECIPIENT_UNAVAILABLE', 'Recipient unavailable'],
  ['OTHER', 'Other']
];

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PartnerJobDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const { toast } = useToast();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [awbRef, setAwbRef] = useState('');
  const [deliveredQty, setDeliveredQty] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [exType, setExType] = useState(EXCEPTION_TYPES[0][0]);
  const [exNote, setExNote] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);
  const pendingAction = useRef<'pickup' | 'deliver' | null>(null);

  const load = useCallback((): void => {
    getJob(id)
      .then(setJob)
      .catch(() => setError("We couldn't load this job. It may belong to another organization."));
  }, [id]);

  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast(message);
      load();
    } catch {
      setError('That action could not be completed. Check the job state and try again.');
    } finally {
      setBusy(false);
    }
  };

  const withPhoto = async (action: 'pickup' | 'deliver'): Promise<void> => {
    pendingAction.current = action;
    photoRef.current?.click();
  };

  const onPhoto = async (file: File | undefined): Promise<void> => {
    if (!file || !pendingAction.current) {
      return;
    }
    const up = await uploadMedia(file.type || 'image/jpeg', await toBase64(file));
    if (pendingAction.current === 'pickup') {
      await act(
        () => confirmPickup(id, { awbRef: awbRef || undefined, mediaObjectId: up.id }),
        'Pickup confirmed'
      );
    } else {
      await act(
        () => deliverJob(id, { deliveredQty: Number(deliveredQty), receiverName: receiverName || undefined, mediaObjectId: up.id }),
        'Delivery recorded — POD saved'
      );
    }
    pendingAction.current = null;
  };

  if (error && !job) {
    return <InlineAlert variant="error" title="Job unavailable" testId="job-error">{error}</InlineAlert>;
  }
  if (!job) {
    return <SkeletonLoader variant="card" count={3} testId="job-loading" />;
  }

  const canAccept = !job.job_accepted_at;
  const canPickup = !!job.job_accepted_at && !job.pickup_at;
  const canTransit = !!job.pickup_at && job.status === 'PLANNED';
  const canDeliver = job.status === 'IN_TRANSIT';

  return (
    <div data-testid="partner-job-detail">
      <PageHeader overline={`${MODE_LABEL[job.mode] ?? job.mode} job`} title={job.ref} testId="job-header" />
      {error && <InlineAlert variant="error" testId="job-action-error">{error}</InlineAlert>}
      <div className="fs-card fs-md-card" data-testid="job-summary">
        <div className="fs-task-card__top">
          <span className="fs-md-card__primary">{job.status === 'DELIVERED' ? 'Delivered' : 'In progress'}</span>
          <StatusPill status={job.status} testId="job-status" />
        </div>
        <div className="fs-md-card__fields">
          <div><div className="fs-md-card__field-label">Pickup</div><div className="fs-md-card__field-value">{job.origin_address ?? 'See order'}</div></div>
          <div><div className="fs-md-card__field-label">Delivery</div><div className="fs-md-card__field-value">{job.dest_address ?? 'See order'}</div></div>
          <div><div className="fs-md-card__field-label">Packages</div><div className="fs-md-card__field-value">{job.package_count ?? '—'}</div></div>
          <div><div className="fs-md-card__field-label">Parcel/AWB ref</div><div className="fs-md-card__field-value">{job.parcel_awb_ref ?? '—'}</div></div>
        </div>
      </div>

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        data-testid="job-photo-input"
        onChange={(e) => void onPhoto(e.target.files?.[0])}
      />

      <div className="fs-md-stack" style={{ marginTop: 'var(--fs-space-4)' }}>
        {canAccept && (
          <button className="fs-btn" disabled={busy} data-testid="job-accept-btn" onClick={() => void act(() => acceptJob(id), 'Job accepted')}>
            Accept job
          </button>
        )}
        {canPickup && (
          <div className="fs-card fs-md-card" data-testid="job-pickup-panel">
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="job-awb">Parcel / AWB / receipt reference (optional)</label>
              <input id="job-awb" className="fs-input" data-testid="job-awb-input" value={awbRef} onChange={(e) => setAwbRef(e.target.value)} />
            </div>
            <button className="fs-btn" disabled={busy} data-testid="job-pickup-btn" onClick={() => void withPhoto('pickup')}>
              Confirm pickup — take photo
            </button>
            <button className="fs-btn fs-btn--ghost" disabled={busy} data-testid="job-pickup-nophoto-btn" onClick={() => void act(() => confirmPickup(id, { awbRef: awbRef || undefined }), 'Pickup confirmed')}>
              Confirm without photo
            </button>
          </div>
        )}
        {canTransit && (
          <button className="fs-btn" disabled={busy} data-testid="job-transit-btn" onClick={() => void act(() => markInTransit(id), 'Marked in transit')}>
            Start transit
          </button>
        )}
        {canDeliver && (
          <div className="fs-card fs-md-card" data-testid="job-deliver-panel">
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="job-qty">Delivered quantity</label>
              <input id="job-qty" className="fs-input fs-num" data-testid="job-qty-input" inputMode="numeric" value={deliveredQty} onChange={(e) => setDeliveredQty(e.target.value)} />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="job-receiver">Received by</label>
              <input id="job-receiver" className="fs-input" data-testid="job-receiver-input" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
            </div>
            <button className="fs-btn" disabled={busy || !deliveredQty} data-testid="job-deliver-btn" onClick={() => void withPhoto('deliver')}>
              Delivered — photo + POD
            </button>
            <button className="fs-btn fs-btn--ghost" disabled={busy || !deliveredQty} data-testid="job-deliver-nophoto-btn" onClick={() => void act(() => deliverJob(id, { deliveredQty: Number(deliveredQty), receiverName: receiverName || undefined }), 'Delivery recorded — POD saved')}>
              Deliver without photo
            </button>
          </div>
        )}

        <div className="fs-card fs-md-card" data-testid="job-exception-panel">
          <span className="fs-h4">Report a problem</span>
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
          <button
            className="fs-btn fs-btn--secondary"
            disabled={busy}
            data-testid="job-exception-btn"
            onClick={() => void act(() => reportJobException(id, { type: exType, note: exNote || undefined }), 'Problem reported to FloraSetu operations')}
          >
            Report to operations
          </button>
        </div>

        {job.exceptions.length > 0 && (
          <div className="fs-card fs-md-card" data-testid="job-exceptions-list">
            <span className="fs-h4">Reported problems</span>
            {job.exceptions.map((e) => (
              <p key={e.id} className="fs-body" style={{ margin: 0 }}>
                {EXCEPTION_TYPES.find(([v]) => v === e.type)?.[1] ?? e.type ?? 'Problem'} · {e.status.toLowerCase()} {e.note ? `· ${e.note}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
