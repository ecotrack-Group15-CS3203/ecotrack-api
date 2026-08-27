import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('rejects an unauthenticated protected route with TOKEN_MISSING', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .expect(401)
      .expect((res: { body: { code?: string } }) => {
        // Mobile's interceptor branches on this code: only TOKEN_EXPIRED triggers a
        // silent refresh, so the three 401 reasons must stay distinguishable.
        expect(res.body.code).toBe('TOKEN_MISSING');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
