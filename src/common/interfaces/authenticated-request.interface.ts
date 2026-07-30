import { Request } from 'express';
import { OrganisationMember } from '../../modules/organisations/entities/organisation-member.entity';

export interface AuthenticatedUser {
  id: string;
  email: string;
  isPlatformAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  membership?: OrganisationMember;
}
