import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Public by design (SRS 3.3.1) — the external uptime monitor polls this every
   * minute with no credentials, and the CI pipeline gates deployment on it. Returns
   * 503 rather than 200 when the database is unreachable so a broken deploy is
   * actually caught instead of reported healthy.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + database connectivity check' })
  async check(@Res({ passthrough: true }) res: Response) {
    const report = await this.healthService.check();
    res.status(
      report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return report;
  }
}
