import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import {
  INCIDENT_IMAGES_DIR,
  TASK_PHOTOS_DIR,
  UPLOADS_ROOT,
} from './common/config/upload.config';

async function bootstrap() {
  mkdirSync(INCIDENT_IMAGES_DIR, { recursive: true });
  mkdirSync(TASK_PHOTOS_DIR, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();

  // Every route is served under /v1 (SRS Appendix B). The mobile client's
  // EXPO_PUBLIC_API_BASE_URL defaults to http://<host>:4000/v1, so the prefix and the
  // default port below are part of the client contract, not cosmetic.
  app.setGlobalPrefix('v1');

  // Static /uploads/ is registered OUTSIDE the prefix and is a placeholder only —
  // it disappears with MediaModule (S3 presigned URLs, SRS 3.1.15).
  app.useStaticAssets(UPLOADS_ROOT, { prefix: '/uploads/' });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('EcoTrack API')
    .setDescription(
      'REST API for the EcoTrack multi-tenant environmental incident monitoring ' +
        'and cleanup coordination platform. Organisation-scoped routes are nested ' +
        'under /organisations/{organisationId}/... — authenticate via WSO2 Asgardeo ' +
        '(OIDC) in the client app and use "Authorize" below to set the resulting ' +
        'bearer access token.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
