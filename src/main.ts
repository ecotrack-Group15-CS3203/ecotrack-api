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
  app.useStaticAssets(UPLOADS_ROOT, { prefix: '/uploads/' });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('EcoTrack API')
    .setDescription(
      'REST API for the EcoTrack multi-tenant environmental incident monitoring ' +
        'and cleanup coordination platform. Organisation-scoped routes are nested ' +
        'under /organisations/{organisationId}/... — call POST /auth/login first ' +
        'and use "Authorize" below to set the bearer token.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
