import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Global guard, runs after JwtAuthGuard and before RolesGuard.
 *
 * Routes that don't take an `:organisationId` param are untouched. Routes that do
 * must match the calling user's own organisation (platform admins are exempt).
 *
 * Unlike the old TypeORM version, this does NOT re-query the database — with the
 * single-org-per-user model, `request.user.organisationId` was already resolved
 * fresh from the `users` table this same request by JwtStrategy.validate() (see
 * modules/auth/strategies/jwt.strategy.ts), which already satisfies the "don't trust
 * the JWT claim blindly" requirement. A second DB round-trip here would be redundant.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organisationId = request.params?.organisationId as string | undefined;

    if (!organisationId) {
      return true;
    }

    if (request.user?.isPlatformAdmin) {
      return true;
    }

    if (!request.user || request.user.organisationId !== organisationId) {
      throw new ForbiddenException('You are not a member of this organisation');
    }

    return true;
  }
}
