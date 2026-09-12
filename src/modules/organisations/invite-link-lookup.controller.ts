import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { InviteLinksService } from './invite-links.service';

/**
 * Top-level `/v1/invites/:token`, not nested under `organisations` — the caller
 * doesn't know the organisation id yet at this point, only the token from the
 * link they opened. Public: this is the read the invite-accept screen uses to
 * show an org name and validity before the user has authenticated at all.
 */
@ApiTags('invite-links')
@Controller('invites')
export class InviteLinkLookupController {
  constructor(private readonly inviteLinksService: InviteLinksService) {}

  // Rate-limited per SRS 3.4.11 — same reasoning as the public invitation lookup
  // in auth.controller.ts: a public, token-guessable endpoint is exactly the
  // enumeration risk that requirement targets.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.inviteLinksService.getPublicInfo(token);
  }
}
