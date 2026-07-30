import { MembershipRole } from './membership-role.enum';

/**
 * Union of every role the RBAC layer can check against a request:
 * the org-scoped MembershipRole values plus the platform-wide admin role,
 * which is not tied to any single organisation.
 */
export const PLATFORM_ADMIN = 'platform_admin' as const;

export type AppRole = MembershipRole | typeof PLATFORM_ADMIN;
