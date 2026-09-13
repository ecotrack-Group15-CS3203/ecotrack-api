import { Global, Module } from '@nestjs/common';
import { drizzleDbProvider, drizzlePoolProvider } from './drizzle.provider';
import { SystemDbService } from './system-db.service';
import { TenantDbService } from './tenant-db.service';

@Global()
@Module({
  providers: [
    drizzlePoolProvider,
    drizzleDbProvider,
    TenantDbService,
    SystemDbService,
  ],
  exports: [
    drizzlePoolProvider,
    drizzleDbProvider,
    TenantDbService,
    SystemDbService,
  ],
})
export class DrizzleModule {}
