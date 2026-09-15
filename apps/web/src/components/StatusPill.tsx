import {
  AlertTriangle,
  Banknote,
  CheckCheck,
  CheckCircle2,
  CircleDot,
  Clock,
  FileSearch,
  FileText,
  Hourglass,
  Info,
  Package,
  PauseCircle,
  PieChart,
  ShieldCheck,
  ThermometerSnowflake,
  Truck,
  XCircle,
  type LucideIcon
} from 'lucide-react';
import { resolveStatus, StatusIcon } from '../design/status';

const ICONS: Record<StatusIcon, LucideIcon> = {
  check: CheckCircle2,
  checks: CheckCheck,
  x: XCircle,
  clock: Clock,
  alert: AlertTriangle,
  info: Info,
  truck: Truck,
  package: Package,
  shield: ShieldCheck,
  pause: PauseCircle,
  snowflake: ThermometerSnowflake,
  bank: Banknote,
  file: FileText,
  hourglass: Hourglass,
  search: FileSearch,
  split: PieChart,
  dot: CircleDot
};

interface StatusPillProps {
  status: string;
  label?: string;
  testId?: string;
}

export function StatusPill({ status, label, testId = 'status-pill' }: StatusPillProps): JSX.Element {
  const spec = resolveStatus(status);
  const Icon = ICONS[spec.icon];
  return (
    <span className={`fs-pill fs-pill--${spec.variant}`} data-testid={testId} data-status={status}>
      <Icon size={14} aria-hidden="true" />
      <span>{label ?? spec.label}</span>
    </span>
  );
}
