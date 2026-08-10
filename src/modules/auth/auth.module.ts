import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * No more JwtModule.registerAsync/JWT_SECRET: EcoTrack doesn't sign its own tokens
 * under delegated auth, it only verifies Asgardeo's (via JwtStrategy's JWKS lookup).
 */
@Module({
  imports: [UsersModule, OrganisationsModule, AuditModule, PassportModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
