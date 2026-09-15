import { Flower2, type LucideIcon } from 'lucide-react';

interface PrimaryActionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  onAction?: () => void;
  testId?: string;
}

export function PrimaryActionCard({
  title,
  description,
  icon: Icon = Flower2,
  onAction,
  testId = 'primary-action-card'
}: PrimaryActionCardProps): JSX.Element {
  return (
    <button type="button" className="fs-primary-action" data-testid={testId} onClick={onAction}>
      <Icon size={28} aria-hidden="true" />
      <span>
        <span className="fs-primary-action__title">{title}</span>
        {description && (
          <>
            <br />
            <span className="fs-primary-action__desc">{description}</span>
          </>
        )}
      </span>
    </button>
  );
}
