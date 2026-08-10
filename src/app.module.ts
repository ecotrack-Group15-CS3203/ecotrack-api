import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { envValidationSchema } from './config/env.validation';
import { DrizzleModule } from './database/drizzle.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganisationsModule } from './modules/organisations/organisations.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { WorkflowModule } from './modules/workflow/workflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    // Request-scoped async context — carries the per-request tenant-scoped Drizzle
    // instance from TenantInterceptor to every injected service (see
    // database/tenant-db.service.ts). `mount: true` sets up the CLS context at the
    // Express middleware layer, before guards/interceptors run.
    ClsModule.forRoot({ middleware: { mount: true }, global: true }),
    DrizzleModule,
    LoggerModule.forRoot({
      pinoHttp: {
        customProps: (req) => ({
          requestId: (req as { id?: string }).id,
          organizationId:
            (req as { user?: { organisationId?: string | null } }).user
              ?.organisationId ?? null,
        }),
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    UsersModule,
    OrganisationsModule,
    WorkflowModule,
    IncidentsModule,
    TasksModule,
    NotificationsModule,
    AuditModule,
    DashboardModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    // Order matters: rate-limit -> authenticate -> resolve tenant -> check role.
    // ThrottlerGuard runs first specifically so it also covers @Public() routes
    // (registration-adjacent flows like invitation redemption).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Runs after all guards (so request.user is populated) — opens the per-request
    // RLS-activated Postgres transaction. See common/interceptors/tenant.interceptor.ts.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
