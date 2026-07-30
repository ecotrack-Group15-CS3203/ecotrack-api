import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { OrganisationMembersService } from '../../modules/organisations/organisation-members.service';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Global guard, runs after JwtAuthGuard and before RolesGuard.
 *
 * Routes that don't take an `:organisationId` param are untouched.
 * Routes that do must resolve to an active membership for the current user
 * (platform admins are exempt, per FR-TEN-04) — enforced fresh from the
 * database on every request rather than trusted from the JWT, per FR-TEN-03.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly membersService: OrganisationMembersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organisationId = request.params?.organisationId as string | undefined;

    if (!organisationId) {
      return true;
    }

    if (request.user?.isPlatformAdmin) {
      return true;
    }

    if (!request.user) {
      return false;
    }

    const membership = await this.membersService.findMembership(
      organisationId,
      request.user.id,
    );

    if (
      !membership ||
      !membership.isActive ||
      !membership.organisation.isActive
    ) {
      throw new ForbiddenException(
        'You are not an active member of this organisation',
      );
    }

    request.membership = membership;
    return true;
  }
}
