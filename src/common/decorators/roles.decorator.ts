import { SetMetadata } from '@nestjs/common';
import { AppRole } from '../enums/app-role.enum';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles; checked by RolesGuard. */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
