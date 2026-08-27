import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// DrizzleModule is @Global, so DRIZZLE_POOL is injectable here without importing it.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
