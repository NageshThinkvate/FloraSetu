import { useState } from 'react';
import { Check, LogOut } from 'lucide-react';
import { useAuth } from '../lib/api/auth';
import { useWorkspace } from '../lib/workspace-context';
import { orgsOf, orgTypeLabel, roleLabel, WORKSPACE_LABEL } from '../lib/workspaces';
import { useMediaQuery } from '../design/useMediaQuery';
import { MOBILE_MAX_QUERY } from '../design/breakpoints';
import { OrganizationHeader } from '../components/OrganizationHeader';
import { Drawer } from '../components/Drawer';
import { SideSheet } from '../components/SideSheet';

export function WorkspaceSwitcher(): JSX.Element {
  const { me, activeOrgId, logout } = useAuth();
  const { workspaces, activeWorkspace, switchContext } = useWorkspace();
  const [open, setOpen] = useState(false);
  const isMobile = useMediaQuery(MOBILE_MAX_QUERY);

  const activeEntry = workspaces.find((w) => w.orgId === activeOrgId && w.workspace === activeWorkspace);
  const groups = orgsOf(workspaces).map((o) => ({
    ...o,
    entries: workspaces.filter((w) => w.orgId === o.orgId)
  }));

  const content = (
    <div className="fs-switcher" data-testid="workspace-switcher-panel">
      {groups.map((g) => (
        <div key={g.orgId} className="fs-switcher__group" data-testid={`switcher-org-${g.orgId.slice(0, 8)}`}>
          <p className="fs-overline" style={{ margin: '0 0 4px' }}>
            {g.orgName}
          </p>
          {g.entries.map((e) => {
            const isActive = e.orgId === activeOrgId && e.workspace === activeWorkspace;
            return (
              <button
                key={`${e.orgId}-${e.workspace}`}
                type="button"
                className={`fs-switcher__option${isActive ? ' fs-switcher__option--active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
                data-testid={`switch-option-${e.workspace}-${g.orgId.slice(0, 8)}`}
                onClick={() => {
                  setOpen(false);
                  switchContext(e.orgId, e.workspace);
                }}
              >
                <span>{WORKSPACE_LABEL[e.workspace]}</span>
                {isActive && <Check size={16} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      ))}
      <button
        type="button"
        className="fs-switcher__option fs-switcher__option--muted"
        data-testid="switcher-logout"
        onClick={() => void logout()}
      >
        <LogOut size={16} aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </div>
  );

  return (
    <>
      <OrganizationHeader
        orgName={activeEntry?.orgName ?? 'Select organization'}
        orgCategory={activeEntry ? orgTypeLabel(activeEntry.orgType) : ''}
        workspaceLabel={activeEntry ? WORKSPACE_LABEL[activeEntry.workspace] : ''}
        userName={me?.display_name ?? ''}
        userRole={activeEntry?.roles.map(roleLabel).join(' · ') ?? ''}
        onSwitch={() => setOpen(true)}
        testId="workspace-switcher"
      />
      {isMobile ? (
        <Drawer open={open} title="Switch organization or workspace" onClose={() => setOpen(false)} testId="workspace-switcher-drawer">
          {content}
        </Drawer>
      ) : (
        <SideSheet open={open} title="Switch organization or workspace" onClose={() => setOpen(false)} testId="workspace-switcher-sheet">
          {content}
        </SideSheet>
      )}
    </>
  );
}
