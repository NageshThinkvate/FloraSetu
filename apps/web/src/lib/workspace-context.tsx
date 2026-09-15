import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './api/auth';
import {
  resolveWorkspaces,
  WorkspaceEntry,
  WorkspaceId,
  WORKSPACE_HOME,
  WORKSPACE_LABEL
} from './workspaces';
import { DirtyForms } from './drafts';
import { useToast } from './toast';
import { ConfirmationDialog } from '../components/ConfirmationDialog';

const STORAGE_KEY = 'florasetu.lastContext';

interface WorkspaceContextValue {
  workspaces: WorkspaceEntry[];
  activeWorkspace: WorkspaceId | null;
  activeEntry: WorkspaceEntry | null;
  restored: boolean;
  switchContext(orgId: string, workspace: WorkspaceId): void;
  adoptContext(orgId: string, workspace: WorkspaceId): void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }): JSX.Element {
  const { me, activeOrgId, selectOrg } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const workspaces = useMemo(() => resolveWorkspaces(me), [me]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId | null>(null);
  const [restored, setRestored] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<WorkspaceEntry | null>(null);

  // Restore last valid context — never a stale/no-longer-authorized one.
  useEffect(() => {
    if (!me) {
      setActiveWorkspace(null);
      setRestored(false);
      return;
    }
    let saved: { orgId: string; workspace: WorkspaceId } | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      saved = raw ? (JSON.parse(raw) as { orgId: string; workspace: WorkspaceId }) : null;
    } catch {
      saved = null;
    }
    const valid = saved
      ? workspaces.find((w) => w.orgId === saved!.orgId && w.workspace === saved!.workspace)
      : undefined;
    if (valid) {
      if (activeOrgId !== valid.orgId) {
        selectOrg(valid.orgId);
      }
      setActiveWorkspace(valid.workspace);
      setRestored(true);
      return;
    }
    const fallback = workspaces.find((w) => w.orgId === activeOrgId) ?? workspaces[0];
    if (fallback) {
      if (activeOrgId !== fallback.orgId) {
        selectOrg(fallback.orgId);
      }
      setActiveWorkspace(fallback.workspace);
    } else {
      setActiveWorkspace(null);
    }
    setRestored(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const persist = (entry: WorkspaceEntry): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ orgId: entry.orgId, workspace: entry.workspace }));
    } catch {
      // ignore
    }
  };

  const adoptContext = useCallback(
    (orgId: string, workspace: WorkspaceId): void => {
      const entry = workspaces.find((w) => w.orgId === orgId && w.workspace === workspace);
      if (!entry) {
        return;
      }
      if (entry.orgId !== activeOrgId) {
        selectOrg(entry.orgId);
      }
      setActiveWorkspace(entry.workspace);
      setRestored(true);
      persist(entry);
      toast(`Now acting as ${entry.orgName} — ${WORKSPACE_LABEL[entry.workspace]}`);
    },
    [workspaces, activeOrgId, selectOrg, toast]
  );

  const doSwitch = useCallback(
    (entry: WorkspaceEntry): void => {
      DirtyForms.discardAll();
      adoptContext(entry.orgId, entry.workspace);
      navigate(WORKSPACE_HOME[entry.workspace]);
    },
    [adoptContext, navigate]
  );

  const switchContext = useCallback(
    (orgId: string, workspace: WorkspaceId): void => {
      const entry = workspaces.find((w) => w.orgId === orgId && w.workspace === workspace);
      if (!entry) {
        return;
      }
      if (entry.orgId === activeOrgId && entry.workspace === activeWorkspace) {
        // Already in this context (e.g. chooser after fallback) — just go to its home.
        navigate(WORKSPACE_HOME[entry.workspace]);
        return;
      }
      if (DirtyForms.hasDirty()) {
        setPendingSwitch(entry);
        return;
      }
      doSwitch(entry);
    },
    [workspaces, activeOrgId, activeWorkspace, doSwitch, navigate]
  );

  const activeEntry =
    workspaces.find((w) => w.orgId === activeOrgId && w.workspace === activeWorkspace) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{ workspaces, activeWorkspace, activeEntry, restored, switchContext, adoptContext }}
    >
      {children}
      <ConfirmationDialog
        open={pendingSwitch !== null}
        title="You have unsaved changes"
        consequence="Switching workspace will discard the unsaved changes in the current form."
        confirmLabel="Discard & switch"
        cancelLabel="Stay here"
        destructive
        onConfirm={() => {
          const target = pendingSwitch;
          setPendingSwitch(null);
          if (target) {
            doSwitch(target);
          }
        }}
        onCancel={() => setPendingSwitch(null)}
        testId="workspace-switch-confirm"
      />
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace outside provider');
  }
  return ctx;
}
