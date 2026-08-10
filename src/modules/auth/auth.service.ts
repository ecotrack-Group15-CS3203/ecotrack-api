import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/drizzle.provider';
import type { DrizzleDb } from '../../database/drizzle.provider';
import { organisations } from '../../database/schema';
import { UsersService } from '../users/users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * No more register/login/logout-with-credentials: Asgardeo issues tokens directly to
 * the client (web via server-side Authorization Code flow, mobile via PKCE), and
 * JwtStrategy just-in-time provisions the local `users` row on first validated token
 * (see strategies/jwt.strategy.ts). This service is now just profile plumbing.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
  ) {}

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    const organisation = user.organisationId
      ? await this.db.query.organisations.findFirst({
          where: eq(organisations.id, user.organisationId),
        })
      : null;
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isPlatformAdmin: user.isPlatformAdmin,
      notificationPreferences: user.notificationPreferences,
      organisation: organisation
        ? {
            id: organisation.id,
            name: organisation.name,
            isActive: organisation.isActive,
          }
        : null,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.usersService.updateProfile(userId, dto);
    return this.getProfile(userId);
  }

  async registerPushToken(userId: string, pushToken: string) {
    await this.usersService.updateProfile(userId, { pushToken });
    return { success: true };
  }
}
