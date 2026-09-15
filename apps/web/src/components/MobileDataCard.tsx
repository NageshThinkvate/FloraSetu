import { ReactNode } from 'react';
import { StatusPill } from './StatusPill';

export interface CardField {
  label: string;
  value: ReactNode;
}

interface MobileDataCardProps {
  primary: ReactNode;
  fields: CardField[];
  status?: string;
  action?: ReactNode;
  testId?: string;
}

export function MobileDataCard({
  primary,
  fields,
  status,
  action,
  testId = 'mobile-data-card'
}: MobileDataCardProps): JSX.Element {
  return (
    <article className="fs-card fs-md-card" data-testid={testId}>
      <div className="fs-task-card__top">
        <span className="fs-md-card__primary">{primary}</span>
        {status && <StatusPill status={status} testId={`${testId}-status`} />}
      </div>
      <div className="fs-md-card__fields">
        {fields.map((f) => (
          <div key={f.label}>
            <div className="fs-md-card__field-label">{f.label}</div>
            <div className="fs-md-card__field-value">{f.value}</div>
          </div>
        ))}
      </div>
      {action}
    </article>
  );
}
