import { UserRole } from './user-role.enum';

/**
 * Union of every role the RBAC layer can check against a request: the
 * UserRole values plus the platform-wide admin flag, which is not tied to any
 * single organisation (kept as a boolean on `users.isPlatformAdmin`, not a UserRole
 * member, since a platform admin isn't a member of any org at all).
 */
export const PLATFORM_ADMIN = 'platform_admin' as const;

export type AppRole = UserRole | typeof PLATFORM_ADMIN;
