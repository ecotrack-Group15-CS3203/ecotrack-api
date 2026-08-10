import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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

  @Public()
  @Get('invitations/:token')
  getInvitationInfo(@Param('token') token: string) {
    return this.invitationsService.getInvitationInfo(token);
  }

  @HttpCode(HttpStatus.OK)
  @Post('invitations/:token/accept')
  acceptInvitation(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitationsService.acceptForUser(token, user.id);
  }
}
