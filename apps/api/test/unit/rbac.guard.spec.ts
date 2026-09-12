// REQ-SEC-01: RBAC guard enforces permission metadata on the request context.
import { ExecutionContext } from '@nestjs/common';
import { RbacGuard } from '../../src/common/authz/rbac.guard';
import { RequestContext } from '../../src/common/request-context';
import { ApiException } from '../../src/common/errors/error-envelope';

const reflectorWith = (perms?: string[]) => ({
  getAllAndOverride: jest.fn().mockReturnValue(perms)
});

const orgContextStub = { resolve: jest.fn() };

const execCtx = {
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({ getRequest: () => ({ headers: {} }) })
} as unknown as ExecutionContext;

function run(permissions: string[], required?: string[], orgStatus?: string): () => Promise<boolean> {
  const guard = new RbacGuard(reflectorWith(required) as never, orgContextStub as never);
  return () =>
    RequestContext.run(
      { traceId: 't', actorType: 'user', userId: 'u', orgId: 'o', roles: [], permissions, orgStatus },
      () => guard.canActivate(execCtx)
    );
}

describe('rbac guard', () => {
  it('allows when all required permissions are present', async () => {
    await expect(run(['config.read'], ['config.read'])()).resolves.toBe(true);
  });

  it('denies with 403 when a permission is missing', async () => {
    await expect(run([], ['config.write'])()).rejects.toMatchObject({ status: 403 });
  });

  it('rejects anonymous callers with 401', async () => {
    const guard = new RbacGuard(reflectorWith(['config.read']) as never, orgContextStub as never);
    await expect(
      RequestContext.run({ traceId: 't', actorType: 'anonymous', roles: [], permissions: [] }, () =>
        guard.canActivate(execCtx)
      )
    ).rejects.toMatchObject({ status: 401 });
  });

  it('blocks transactional permissions for suspended orgs but allows reads', async () => {
    await expect(run(['org.write'], ['org.write'], 'SUSPENDED')()).rejects.toMatchObject({
      status: 403,
      code: 'ORG_SUSPENDED'
    });
    await expect(run(['org.read'], ['org.read'], 'SUSPENDED')()).resolves.toBe(true);
  });

  it('denies non-ApiException surprises as ApiException', async () => {
    await expect(run([], ['config.write'])()).rejects.toBeInstanceOf(ApiException);
  });
});
