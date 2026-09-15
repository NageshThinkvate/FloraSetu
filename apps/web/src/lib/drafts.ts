// Local draft persistence (UX-ADR-006): quick request / event / quote drafts and forms only.
// Keys are organization + workspace + form scoped so one org's draft can never surface in another.
const PREFIX = 'florasetu.draft.';

export function draftKey(orgId: string, workspace: string, formId: string): string {
  return `${PREFIX}${orgId}.${workspace}.${formId}`;
}

export function saveDraft(orgId: string, workspace: string, formId: string, value: unknown): void {
  try {
    sessionStorage.setItem(draftKey(orgId, workspace, formId), JSON.stringify(value));
  } catch {
    // storage full/blocked — drafts are best-effort
  }
}

export function loadDraft<T>(orgId: string, workspace: string, formId: string): T | null {
  try {
    const raw = sessionStorage.getItem(draftKey(orgId, workspace, formId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(orgId: string, workspace: string, formId: string): void {
  try {
    sessionStorage.removeItem(draftKey(orgId, workspace, formId));
  } catch {
    // ignore
  }
}

// Registry of forms with unsaved changes — consulted before workspace/org switches.
const dirtyForms = new Set<string>();

export const DirtyForms = {
  register(formId: string): void {
    dirtyForms.add(formId);
  },
  unregister(formId: string): void {
    dirtyForms.delete(formId);
  },
  hasDirty(): boolean {
    return dirtyForms.size > 0;
  },
  discardAll(): void {
    dirtyForms.clear();
  }
};
