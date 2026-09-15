import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PublicStatsService } from './public-stats.service';

@ApiTags('public')
@Controller('public')
export class PublicStatsController {
  constructor(private readonly publicStatsService: PublicStatsService) {}

  /**
   * Backs the landing page's stats row. Aggregate counts only: no names, ids or
   * locations ever leave through here. Deliberately not throttled, because the only
   * caller is the web app's server, and a per-IP limit would throttle the web app
   * itself rather than any individual visitor.
   */
  @Public()
  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide totals for the public landing page' })
  getStats() {
    return this.publicStatsService.get();
  }
}
