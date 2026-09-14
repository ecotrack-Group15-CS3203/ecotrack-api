import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
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
    // Backs NotificationDispatchService's @Cron (notifications/dispatch/) — the
    // single scheduler for proximity alerts, task-due, and event reminders. No
    // Redis/queue involved (Appendix C excludes both); see that service's header
    // comment for why a plain outbox table is the right size for this deployment.
    ScheduleModule.forRoot(),
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
    // Not applied globally (see the APP_GUARD list below) — SRS 3.4.11 scopes
    // rate limiting to specific auth-sensitive endpoints, not every route. Still
    // registered here so those routes' local `@UseGuards(ThrottlerGuard)` +
    // `@Throttle(...)` have a storage provider and a 'default' config to fall back on.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    UsersModule,
    OrganisationsModule,
    WorkflowModule,
    IncidentsModule,
    TasksModule,
    EventsModule,
    NotificationsModule,
    AuditModule,
    DashboardModule,
    AuthModule,
    HealthModule,
    MediaModule,
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
    // Order matters: authenticate -> resolve tenant -> check role. Rate limiting is
    // NOT global (SRS 3.4.11 scopes it to specific auth-sensitive endpoints, not
    // every route) — those endpoints apply `ThrottlerGuard` locally via
    // `@UseGuards`. Nest runs global guards before method-level ones, so on an
    // authenticated route the throttle check happens after JwtAuthGuard/TenantGuard/
    // RolesGuard, not before; this only matters for `@Public()` routes, where those
    // three are no-ops anyway (see JwtAuthGuard.canActivate).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Runs after all guards (so request.user is populated) — opens the per-request
    // RLS-activated Postgres transaction. See common/interceptors/tenant.interceptor.ts.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
