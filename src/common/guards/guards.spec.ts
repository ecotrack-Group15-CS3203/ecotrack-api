import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ADMIN } from '../enums/app-role.enum';
import { UserRole } from '../enums/user-role.enum';
import { RolesGuard } from './roles.guard';
import { TenantGuard } from './tenant.guard';

/** SRS 3.4.5 (RBAC) and 3.1.19 (tenant isolation at the HTTP layer). */
function context(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  role: UserRole.CITIZEN,
  organisationId: null,
  isPlatformAdmin: false,
  ...over,
});

describe('RolesGuard', () => {
  const guardFor = (roles: unknown) =>
    new RolesGuard({ getAllAndOverride: () => roles } as unknown as Reflector);

  it('allows any authenticated caller when the route declares no roles', () => {
    expect(guardFor(undefined).canActivate(context({ user: user() }))).toBe(
      true,
    );
    expect(guardFor([]).canActivate(context({ user: user() }))).toBe(true);
  });

  it('allows a caller whose role is listed', () => {
    const guard = guardFor([UserRole.ORG_ADMIN]);
    expect(
      guard.canActivate(context({ user: user({ role: UserRole.ORG_ADMIN }) })),
    ).toBe(true);
  });

  it('refuses a caller whose role is not listed', () => {
    const guard = guardFor([UserRole.ORG_ADMIN]);
    expect(
      guard.canActivate(context({ user: user({ role: UserRole.VOLUNTEER }) })),
    ).toBe(false);
  });

  it('refuses a request with no authenticated user', () => {
    expect(guardFor([UserRole.CITIZEN]).canActivate(context({}))).toBe(false);
  });

  it('lets a platform admin through only routes that list PLATFORM_ADMIN', () => {
    const admin = user({ isPlatformAdmin: true });
    expect(
      guardFor([UserRole.ORG_ADMIN, PLATFORM_ADMIN]).canActivate(
        context({ user: admin }),
      ),
    ).toBe(true);
    expect(
      guardFor([UserRole.ORG_ADMIN]).canActivate(context({ user: admin })),
    ).toBe(false);
  });
});

describe('TenantGuard', () => {
  const guard = new TenantGuard();

  it('ignores routes without an :organisationId parameter', () => {
    expect(guard.canActivate(context({ params: {}, user: user() }))).toBe(true);
  });

  it("allows a member into their own organisation's routes", () => {
    const req = {
      params: { organisationId: 'org-a' },
      user: user({ organisationId: 'org-a' }),
    };
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it("refuses another organisation's routes with 403", () => {
    const req = {
      params: { organisationId: 'org-b' },
      user: user({ organisationId: 'org-a' }),
    };
    expect(() => guard.canActivate(context(req))).toThrow(ForbiddenException);
  });

  it('refuses a user with no organisation', () => {
    const req = { params: { organisationId: 'org-a' }, user: user() };
    expect(() => guard.canActivate(context(req))).toThrow(ForbiddenException);
  });

  it('lets a platform admin into any organisation', () => {
    const req = {
      params: { organisationId: 'org-b' },
      user: user({ isPlatformAdmin: true }),
    };
    expect(guard.canActivate(context(req))).toBe(true);
  });
});
