import { ChevronsUpDown } from 'lucide-react';

interface OrganizationHeaderProps {
  orgName: string;
  orgCategory: string;
  workspaceLabel: string;
  userName: string;
  userRole: string;
  onSwitch?: () => void;
  testId?: string;
}

export function OrganizationHeader({
  orgName,
  orgCategory,
  workspaceLabel,
  userName,
  userRole,
  onSwitch,
  testId = 'organization-header'
}: OrganizationHeaderProps): JSX.Element {
  const inner = (
    <>
      <span className="fs-org-header__mark" aria-hidden="true">
        {orgName.charAt(0).toUpperCase()}
      </span>
      <span>
        <span className="fs-org-header__name">
          {orgName} · {workspaceLabel}
        </span>
        <br />
        <span className="fs-org-header__sub">
          {orgCategory} · {userName} · {userRole}
        </span>
      </span>
      {onSwitch && <ChevronsUpDown size={16} aria-hidden="true" />}
    </>
  );
  if (onSwitch) {
    return (
      <button
        type="button"
        className="fs-org-header"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', font: 'inherit', textAlign: 'left' }}
        data-testid={testId}
        onClick={onSwitch}
        aria-label={`Switch workspace — currently ${orgName}, ${workspaceLabel}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="fs-org-header" data-testid={testId}>
      {inner}
    </div>
  );
}
