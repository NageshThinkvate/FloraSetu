import { apiGet, apiPost } from './client';

export interface LogisticsJob {
  id: string;
  ref: string;
  order_id: string;
  status: string;
  mode: string | null;
  carrier_name: string | null;
  transport_ref: string | null;
  parcel_awb_ref: string | null;
  origin_text: string | null;
  destination_text: string | null;
  origin_terminal: string | null;
  destination_terminal: string | null;
  last_mile_detail: string | null;
  handling_note: string | null;
  temp_controlled: boolean | null;
  package_count: number | null;
  vehicle_ref: string | null;
  pickup_at: string | null;
  etd: string | null;
  eta: string | null;
  job_accepted_at: string | null;
  arrived_pickup_at: string | null;
  arrived_delivery_at: string | null;
  driver_user_id: string | null;
  driver_name: string | null;
  logistics_org_id: string | null;
  open_exceptions: number;
  created_at: string;
}

export interface JobMedia {
  id: string;
  media_object_id: string;
  purpose: string;
  captured_at: string;
  url: string | null;
}

export interface JobException {
  id: string;
  type: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

export interface JobPod {
  id: string;
  delivered_qty: string;
  receiver_name: string | null;
  pod_ref: string | null;
  notes: string | null;
  created_at: string;
  url: string | null;
  signature_url: string | null;
}

export interface JobEvent {
  id: string;
  event_type: string;
  actor_name: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface JobAssignment {
  id: string;
  action: string;
  driver_name: string | null;
  previous_driver_name: string | null;
  vehicle_ref: string | null;
  reason: string | null;
  created_at: string;
}

export interface JobDetail extends LogisticsJob {
  order_ref: string | null;
  pickup_company: string | null;
  delivery_company: string | null;
  media: JobMedia[];
  exceptions: JobException[];
  pods: JobPod[];
  events: JobEvent[];
  assignments: JobAssignment[];
}

export interface JobsDashboard {
  new_jobs: number;
  pickup_today: number;
  awaiting_pickup: number;
  in_transit: number;
  delivery_today: number;
  pod_missing: number;
  exceptions_open: number;
}

export interface EligibleDriver {
  userId: string;
  ref: string;
  displayName: string;
  roles: string[];
}

export const listPartnerJobs = (): Promise<{ items: LogisticsJob[] }> => apiGet('/logistics/jobs');
export const listDriverJobs = (): Promise<{ items: LogisticsJob[] }> => apiGet('/logistics/jobs/mine');
export const getJobsDashboard = (): Promise<JobsDashboard> => apiGet('/logistics/jobs/dashboard');
export const listEligibleDrivers = (): Promise<{ items: EligibleDriver[] }> => apiGet('/logistics/jobs/eligible-drivers');
export const getJob = (id: string): Promise<JobDetail> => apiGet(`/logistics/jobs/${id}`);
export const acceptJob = (id: string): Promise<unknown> => apiPost(`/logistics/jobs/${id}/accept`);
export const arrivedAtPickup = (id: string): Promise<unknown> => apiPost(`/logistics/jobs/${id}/arrived-pickup`);
export const arrivedAtDelivery = (id: string): Promise<unknown> => apiPost(`/logistics/jobs/${id}/arrived-delivery`);
export const confirmPickup = (id: string, body: { awbRef?: string; transportRef?: string; mediaObjectId?: string }): Promise<unknown> =>
  apiPost(`/logistics/jobs/${id}/pickup`, body);
export const markInTransit = (id: string): Promise<unknown> => apiPost(`/logistics/jobs/${id}/transit`);
export const deliverJob = (id: string, body: {
  deliveredQty: number;
  receiverName?: string;
  mediaObjectId?: string;
  signatureMediaObjectId?: string;
  podRef?: string;
  notes?: string;
}): Promise<unknown> => apiPost(`/logistics/jobs/${id}/deliver`, body);
export const reportJobException = (id: string, body: { type: string; note?: string; mediaObjectId?: string }): Promise<unknown> =>
  apiPost(`/logistics/jobs/${id}/exception`, body);
export const assignDriver = (id: string, body: { driverUserId: string; vehicleRef?: string; reason?: string }): Promise<unknown> =>
  apiPost(`/logistics/jobs/${id}/assign-driver`, body);
export const unassignDriver = (id: string, body: { reason?: string }): Promise<unknown> =>
  apiPost(`/logistics/jobs/${id}/unassign-driver`, body);

export const uploadMedia = (contentType: string, dataBase64: string): Promise<{ id: string }> =>
  apiPost('/media', { contentType, dataBase64, bucket: 'pilot' });
