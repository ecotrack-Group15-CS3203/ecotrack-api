import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * JWTs are stateless, so there is nothing to invalidate server-side;
   * this endpoint exists to satisfy FR-AUTH-04 and gives clients a
   * single place to call before discarding their token.
   */
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout() {
    return { success: true };
  }

  @Get('me')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  @Public()
  @Get('invitations/:token')
  getInvitationInfo(@Param('token') token: string) {
    return this.authService.getInvitationInfo(token);
  }

  @HttpCode(HttpStatus.OK)
  @Post('invitations/:token/accept')
  acceptInvitation(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.acceptInvitationForExistingUser(token, user.id);
  }
}
