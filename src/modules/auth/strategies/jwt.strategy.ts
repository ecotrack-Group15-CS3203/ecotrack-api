import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import * as jwksRsa from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { UsersService } from '../../users/users.service';
import { AsgardeoJwtPayload } from '../interfaces/jwt-payload.interface';

/** OIDC_AUDIENCE is a comma-separated list; empty means "don't check". */
function parseAudience(raw: string | undefined): string[] | undefined {
  const audience = (raw ?? '')
    .split(',')
    .map((clientId) => clientId.trim())
    .filter(Boolean);
  return audience.length ? audience : undefined;
}

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
      // Asgardeo sets `aud` to the client ID the token was issued to. Checked only
      // when configured, so a deployment that hasn't set it can't lock itself out.
      audience: parseAudience(config.get<string>('OIDC_AUDIENCE')),
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: config.get<string>('OIDC_JWKS_URI')!,
      }),
    });
  }

  async validate(payload: AsgardeoJwtPayload): Promise<AuthenticatedUser> {
    // Asgardeo does not put `email` in an access token unless it is added to the
    // application's Access Token Attributes (not the User Attributes tab). Without
    // it, provisioning cannot satisfy
    // `users.email` NOT NULL, so fail with something that names the fix rather than
    // throwing a TypeError deeper in.
    if (!payload.email) {
      throw new UnauthorizedException(
        "Access token has no `email` claim. Add email to the application's Access Token Attributes in the Asgardeo console.",
      );
    }

    // `??` alone is wrong here: `[].filter(Boolean).join(' ')` yields '', which is not
    // nullish, so a name assembled from absent given/family names would silently win
    // as an empty string. Pick the first non-empty candidate instead.
    const assembledName = [payload.given_name, payload.family_name]
      .filter(Boolean)
      .join(' ');
    const fullName =
      [payload.name, assembledName].find((candidate) => !!candidate?.trim()) ??
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
