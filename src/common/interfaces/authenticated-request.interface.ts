import { Request } from 'express';
import { UserRole } from '../enums/user-role.enum';

/**
 * Fully DB-resolved on every request by JwtStrategy.validate() (see
 * modules/auth/strategies/jwt.strategy.ts) — role/organisationId are never trusted
 * directly from the JWT claims, even though Asgardeo's token also carries them, so a
 * revoked membership or role change takes effect immediately rather than waiting for
 * the access token to expire (up to 1h). There is no separate "membership" concept
 * any more: single-org-per-user means this row IS the membership.
 */
export interface AuthenticatedUser {
  id: string;
  authSubject: string;
  email: string;
  fullName: string;
  role: UserRole;
  organisationId: string | null;
  isPlatformAdmin: boolean;
  isActive: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
