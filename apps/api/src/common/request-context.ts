import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextData {
  traceId: string;
  actorType: 'anonymous' | 'user' | 'system';
  userId?: string;
  orgId?: string;
  roles: string[];
  permissions: string[];
  orgStatus?: string;
  orgType?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error('RequestContext not initialized (trace middleware must run first)');
    }
    return ctx;
  },
  maybeGet(): RequestContextData | undefined {
    return storage.getStore();
  },
  requireOrgId(): string {
    const ctx = this.get();
    if (!ctx.orgId) {
      throw new Error('OrgContext required but not present');
    }
    return ctx.orgId;
  }
};
