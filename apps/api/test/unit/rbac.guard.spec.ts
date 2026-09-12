// REQ-SEC-01: RBAC guard enforces permission metadata on the request context.
import { RbacGuard } from '../../src/common/authz/rbac.guard';
import { RequestContext } from '../../src/common/request-context';
import { ApiException } from '../../src/common/errors/error-envelope';

const reflectorWith = (perms?: string[]) => ({
  getAllAndOverride: jest.fn().mockReturnValue(perms)
});

const execCtx = { getHandler: () => ({}), getClass: () => ({}) } as never;

function run(permissions: string[], required?: string[]): () => boolean {
  const guard = new RbacGuard(reflectorWith(required) as never);
  return () =>
    RequestContext.run(
      { traceId: 't', actorType: 'user', userId: 'u', orgId: 'o', roles: [], permissions },
      () => guard.canActivate(execCtx)
    );
}

describe('rbac guard', () => {
  it('allows when all required permissions are present', () => {
    expect(run(['config.read'], ['config.read'])()).toBe(true);
  });

  it('denies with 403 when a permission is missing', () => {
    expect(run([], ['config.write'])).toThrow(ApiException);
    try {
      run([], ['config.write'])();
    } catch (err) {
      expect((err as ApiException).status).toBe(403);
    }
  });

  it('rejects anonymous callers with 401', () => {
    const guard = new RbacGuard(reflectorWith(['config.read']) as never);
    expect(() =>
      RequestContext.run({ traceId: 't', actorType: 'anonymous', roles: [], permissions: [] }, () =>
        guard.canActivate(execCtx)
      )
    ).toThrow(ApiException);
  });
});
