import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { INCIDENT_IMAGES_DIR, UPLOADS_ROOT } from './common/config/upload.config';

async function bootstrap() {
  mkdirSync(INCIDENT_IMAGES_DIR, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.useStaticAssets(UPLOADS_ROOT, { prefix: '/uploads/' });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
