import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();

  // Every route is served under /v1 (SRS Appendix B). Both clients append /v1 to a
  // configured host, so the prefix and the default port below are part of the
  // client contract, not cosmetic.
  app.setGlobalPrefix('v1');

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
