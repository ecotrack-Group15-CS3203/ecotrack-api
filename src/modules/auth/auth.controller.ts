import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { InvitationsService } from '../organisations/invitations.service';
import { AuthService } from './auth.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly invitationsService: InvitationsService,
  ) {}

  /**
   * No /register, /login, or /logout: Asgardeo owns the entire credential lifecycle.
   * A client with a valid Asgardeo access token is, by construction, authenticated —
   * there's nothing for EcoTrack's own API to do at login/logout time beyond this
   * profile read, which also happens to just-in-time provision the user on first call
   * (see strategies/jwt.strategy.ts).
   */
  @Get('me')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Patch('me')
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Patch('push-token')
  registerPushToken(
    @Body() dto: RegisterPushTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.registerPushToken(user.id, dto.pushToken);
  }

  /**
   * SRS 3.11.1's right to erasure, Appendix B's `DELETE /users/me` under this
   * codebase's actual `/auth/me` naming (same GET/PATCH route already lives here).
   * Database-local — see UsersService.deleteAccount()'s doc comment for the
   * Asgardeo-identity limitation this doesn't address.
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('me')
  deleteAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.deleteAccount(user.id);
  }

  // Rate-limited per SRS 3.4.11 — a public, token-guessable lookup is exactly the
  // enumeration risk that requirement targets. Applied locally, not globally; see
  // app.module.ts.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Get('invitations/:token')
  getInvitationInfo(@Param('token') token: string) {
    return this.invitationsService.getInvitationInfo(token);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('invitations/:token/accept')
  acceptInvitation(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitationsService.acceptForUser(token, user.id);
  }
}
