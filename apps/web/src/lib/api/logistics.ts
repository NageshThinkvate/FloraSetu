import { apiGet, apiPost } from './client';

export interface LogisticsJob {
  id: string;
  ref: string;
  order_id: string;
  status: string;
  mode: string;
  carrier_name: string | null;
  transport_ref: string | null;
  parcel_awb_ref: string | null;
  origin_address: string | null;
  dest_address: string | null;
  package_count: number | null;
  pickup_at: string | null;
  etd: string | null;
  eta: string | null;
  job_accepted_at: string | null;
  driver_user_id: string | null;
  logistics_org_id: string | null;
  created_at: string;
}

export interface JobMedia {
  id: string;
  media_object_id: string;
  purpose: string;
  captured_at: string;
}

export interface JobException {
  id: string;
  type: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

export interface JobDetail extends LogisticsJob {
  media: JobMedia[];
  exceptions: JobException[];
  pods: { id: string; delivered_qty: string; receiver_name: string | null; created_at: string }[];
}

export const listPartnerJobs = (): Promise<{ items: LogisticsJob[] }> => apiGet('/logistics/jobs');
export const listDriverJobs = (): Promise<{ items: LogisticsJob[] }> => apiGet('/logistics/jobs/mine');
export const getJob = (id: string): Promise<JobDetail> => apiGet(`/logistics/jobs/${id}`);
export const acceptJob = (id: string): Promise<unknown> => apiPost(`/logistics/jobs/${id}/accept`);
export const confirmPickup = (id: string, body: { awbRef?: string; transportRef?: string; mediaObjectId?: string }): Promise<unknown> =>
  apiPost(`/logistics/jobs/${id}/pickup`, body);
export const markInTransit = (id: string): Promise<unknown> => apiPost(`/logistics/jobs/${id}/transit`);
export const deliverJob = (id: string, body: { deliveredQty: number; receiverName?: string; mediaObjectId?: string; notes?: string }): Promise<unknown> =>
  apiPost(`/logistics/jobs/${id}/deliver`, body);
export const reportJobException = (id: string, body: { type: string; note?: string; mediaObjectId?: string }): Promise<unknown> =>
  apiPost(`/logistics/jobs/${id}/exception`, body);

export const uploadMedia = (contentType: string, dataBase64: string): Promise<{ id: string }> =>
  apiPost('/media', { contentType, dataBase64, bucket: 'pilot' });
