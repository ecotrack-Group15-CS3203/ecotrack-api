import { Global, Module } from '@nestjs/common';
import { drizzleDbProvider, drizzlePoolProvider } from './drizzle.provider';
import { TenantDbService } from './tenant-db.service';

@Global()
@Module({
  providers: [drizzlePoolProvider, drizzleDbProvider, TenantDbService],
  exports: [drizzlePoolProvider, drizzleDbProvider, TenantDbService],
})
export class DrizzleModule {}
