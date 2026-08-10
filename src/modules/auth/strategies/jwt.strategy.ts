import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import * as jwksRsa from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { UsersService } from '../../users/users.service';
import { AsgardeoJwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Validates every protected request's access token against Asgardeo's live JWKS
 * endpoint (RS256) instead of a locally-held HS256 secret — EcoTrack no longer issues
 * its own tokens. `OIDC_JWKS_URI` should point at a mock JWKS server for local
 * dev/CI until Milestone 1 (Asgardeo console setup) is done; swap to the real
 * Asgardeo tenant's JWKS URL once it exists — nothing else in this file changes.
 *
 * `validate()` just-in-time provisions a `users` row for a never-seen `sub`
 * (`findOrProvisionByAuthSubject`) and returns the DB-resolved role/organisationId,
 * NOT the token's own `role`/`organizationId` claims — see
 * common/interfaces/authenticated-request.interface.ts's doc comment for why.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer: config.get<string>('OIDC_ISSUER') || undefined,
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: config.get<string>('OIDC_JWKS_URI')!,
      }),
    });
  }

  async validate(payload: AsgardeoJwtPayload): Promise<AuthenticatedUser> {
    const fullName =
      payload.name ??
      [payload.given_name, payload.family_name].filter(Boolean).join(' ') ??
      payload.email.split('@')[0];

    const user = await this.usersService.findOrProvisionByAuthSubject({
      authSubject: payload.sub,
      email: payload.email,
      fullName,
    });

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    return {
      id: user.id,
      authSubject: user.authSubject,
      email: user.email,
      fullName: user.fullName,
      // Drizzle's pgEnum infers a plain string-literal union, not the UserRole TS
      // enum — the values are identical (schema/enums.schema.ts's roleEnum is kept
      // in sync with UserRole by hand), so this cast is safe.
      role: user.role as UserRole,
      organisationId: user.organisationId,
      isPlatformAdmin: user.isPlatformAdmin,
      isActive: user.isActive,
    };
  }
}
