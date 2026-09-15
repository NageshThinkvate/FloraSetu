export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'accent';

export type StatusIcon =
  | 'check'
  | 'checks'
  | 'x'
  | 'clock'
  | 'alert'
  | 'info'
  | 'truck'
  | 'package'
  | 'shield'
  | 'pause'
  | 'snowflake'
  | 'bank'
  | 'file'
  | 'hourglass'
  | 'search'
  | 'split'
  | 'dot';

export interface StatusSpec {
  label: string;
  variant: StatusVariant;
  icon: StatusIcon;
}

// Human-facing vocabulary for backend status codes (UI_UX_DESIGN_SYSTEM.md §5).
// Backend codes stay unchanged in API/audit; this map is presentation-only.
export const STATUS_MAP: Record<string, StatusSpec> = {
  DRAFT: { label: 'Draft', variant: 'neutral', icon: 'file' },
  SUBMITTED: { label: 'Submitted', variant: 'info', icon: 'check' },
  PUBLISHED: { label: 'Collecting offers', variant: 'info', icon: 'clock' },
  QUOTING: { label: 'Collecting offers', variant: 'info', icon: 'clock' },
  SOURCING: { label: 'Sourcing', variant: 'info', icon: 'clock' },
  PLANNED: { label: 'Planned', variant: 'neutral', icon: 'dot' },
  PARTIALLY_AWARDED: { label: 'Some flowers confirmed', variant: 'info', icon: 'split' },
  FULLY_AWARDED: { label: 'All flowers confirmed', variant: 'success', icon: 'checks' },
  AWARDED: { label: 'Selected', variant: 'success', icon: 'check' },
  REJECTED: { label: 'Not selected', variant: 'neutral', icon: 'x' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'neutral', icon: 'x' },
  SUPERSEDED: { label: 'Replaced by new version', variant: 'neutral', icon: 'dot' },
  EXPIRED: { label: 'Expired', variant: 'neutral', icon: 'clock' },
  CLOSED: { label: 'Closed', variant: 'neutral', icon: 'check' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral', icon: 'x' },

  PENDING_CONFIRMATION: { label: 'Awaiting supplier confirmation', variant: 'warning', icon: 'hourglass' },
  SUPPLY_CONFIRMED: { label: 'Supplier confirmed', variant: 'info', icon: 'check' },
  ALLOCATING: { label: 'Sourcing supply', variant: 'info', icon: 'package' },
  ALLOCATED: { label: 'Supply reserved', variant: 'info', icon: 'package' },
  QC_PACK: { label: 'Packing after quality check', variant: 'info', icon: 'package' },
  PACKED: { label: 'Packed', variant: 'info', icon: 'package' },
  READY_FOR_DISPATCH: { label: 'Ready to ship', variant: 'info', icon: 'package' },
  DISPATCHED: { label: 'Dispatched', variant: 'info', icon: 'truck' },
  IN_TRANSIT: { label: 'On the way', variant: 'info', icon: 'truck' },
  DELIVERED: { label: 'Delivered', variant: 'success', icon: 'check' },
  STOCK_RECEIVED: { label: 'Stock received', variant: 'success', icon: 'check' },
  ACCEPTANCE_PENDING: { label: 'Review your delivery', variant: 'warning', icon: 'alert' },

  QC_PENDING: { label: 'Quality check pending', variant: 'warning', icon: 'clock' },
  QC_PASSED: { label: 'Quality check passed', variant: 'success', icon: 'check' },
  QC_REJECTED: { label: 'Quality check failed', variant: 'error', icon: 'x' },
  ON_HOLD: { label: 'On hold', variant: 'warning', icon: 'pause' },
  STORAGE_HOLD: { label: 'Storage hold', variant: 'warning', icon: 'pause' },
  COLD_CHAIN_ALERT: { label: 'Temperature alert — under review', variant: 'error', icon: 'snowflake' },
  AVAILABLE: { label: 'Available', variant: 'success', icon: 'check' },
  RESERVED: { label: 'Reserved', variant: 'info', icon: 'package' },
  EXHAUSTED: { label: 'Fully used', variant: 'neutral', icon: 'dot' },

  RECORDED: { label: 'Payment recorded', variant: 'info', icon: 'bank' },
  VERIFIED: { label: 'Verified', variant: 'success', icon: 'check' },
  PAID: { label: 'Paid', variant: 'success', icon: 'bank' },
  FROZEN: { label: 'Frozen — review pending', variant: 'warning', icon: 'pause' },
  PENDING_REVERIFICATION: { label: 'Re-verification pending', variant: 'warning', icon: 'hourglass' },

  KYB_NOT_STARTED: { label: 'Verification not started', variant: 'neutral', icon: 'file' },
  KYB_UNDER_REVIEW: { label: 'Verification under review', variant: 'warning', icon: 'search' },
  KYB_CORRECTION_REQUIRED: { label: 'Action needed on documents', variant: 'error', icon: 'alert' },
  KYB_VERIFIED: { label: 'Business verified', variant: 'success', icon: 'shield' },
  KYB_REJECTED: { label: 'Verification rejected', variant: 'error', icon: 'x' },

  CLAIM_OPEN: { label: 'Issue being reviewed', variant: 'warning', icon: 'alert' },
  CLAIM_UNDER_REVIEW: { label: 'Issue being reviewed', variant: 'warning', icon: 'alert' },
  CLAIM_RESOLVED: { label: 'Issue resolved', variant: 'success', icon: 'check' },
  CLAIM_REJECTED: { label: 'Issue declined', variant: 'error', icon: 'x' },

  ACTIVE: { label: 'Active', variant: 'success', icon: 'check' },
  SUSPENDED: { label: 'Suspended', variant: 'error', icon: 'pause' },
  VALIDATED: { label: 'Validated', variant: 'success', icon: 'check' },
  PENDING_REVIEW: { label: 'Pending review', variant: 'warning', icon: 'clock' },
  DEMO: { label: 'Demo data', variant: 'accent', icon: 'dot' }
};

export function resolveStatus(code: string): StatusSpec {
  const known = STATUS_MAP[code];
  if (known) {
    return known;
  }
  const human = code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return { label: human, variant: 'neutral', icon: 'dot' };
}
