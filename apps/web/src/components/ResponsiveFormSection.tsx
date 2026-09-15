import { ReactNode, useState } from 'react';

interface ResponsiveFormSectionProps {
  title: string;
  helper?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}

export function ResponsiveFormSection({
  title,
  helper,
  collapsible = false,
  defaultOpen = true,
  children,
  testId = 'form-section'
}: ResponsiveFormSectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset className="fs-form-section" data-testid={testId}>
      <legend className="fs-form-section__legend">
        {collapsible ? (
          <button
            type="button"
            className="fs-page-header__back"
            data-testid={`${testId}-toggle`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {title} {open ? '−' : '+'}
          </button>
        ) : (
          title
        )}
      </legend>
      {helper && (open || !collapsible) && <p className="fs-form-section__helper">{helper}</p>}
      {open && children}
    </fieldset>
  );
}
