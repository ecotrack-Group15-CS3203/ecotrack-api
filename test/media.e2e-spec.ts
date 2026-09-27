import * as crypto from 'crypto';
import request from 'supertest';
import { Fixtures, FixtureUser } from './support/fixtures';
import { ensureMediaBucket, queryParam } from './support/s3';
import { createTestApp, TestApp } from './support/test-app';

/**
 * Direct-to-S3 media uploads (SRS 3.1.15, 3.3.2, 3.4.8).
 *
 * The API never touches image bytes: it hands out a presigned PUT, the client
 * uploads straight to the bucket, and reads go through a presigned GET that is only
 * issued once the caller is shown to be allowed to see the object. These tests run
 * that whole loop against a real S3-compatible store (MinIO locally, s3mock in CI).
 *
 * Not covered here, and verified manually against real AWS S3 instead: that an
 * expired URL is refused (would need a 5-minute wait), and that a PUT with a
 * different Content-Type is refused — s3mock does not verify signatures, so only
 * the fact that `content-type` is *signed* is asserted below.
 */

type UploadTarget = { uploadUrl: string; mediaUrl: string; objectKey: string };

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const OBJECT_KEY = /^[0-9a-f-]{36}\.jpg$/;

describe('Media upload & retrieval (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;

  let orgB: string;
  let reporter: FixtureUser;
  let otherCitizen: FixtureUser;

  beforeAll(async () => {
    await ensureMediaBucket();
    t = await createTestApp();
    fx = new Fixtures('media', t.jwks);
    await fx.setup();

    orgB = await fx.org('org-b');
    reporter = await fx.user('reporter');
    otherCitizen = await fx.user('other-citizen');
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  const requestUpload = (
    token: string,
    body: Record<string, unknown> = {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    },
  ) =>
    request(t.server)
      .post('/media/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const requestDownload = (token: string, objectKey: string) =>
    request(t.server)
      .get(`/media/${objectKey}`)
      .set('Authorization', `Bearer ${token}`);

  describe('POST /media/upload-url', () => {
    it('requires authentication', async () => {
      const res = await request(t.server)
        .post('/media/upload-url')
        .send({ filename: 'photo.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(401);
    });

    it('issues a presigned PUT that expires after 5 minutes and signs the content type', async () => {
      const res = await requestUpload(reporter.token);
      expect(res.status).toBe(201);
      const target = res.body as UploadTarget;

      expect(target.objectKey).toMatch(OBJECT_KEY);
      expect(target.mediaUrl.endsWith(`/${target.objectKey}`)).toBe(true);
      expect(queryParam(target.uploadUrl, 'X-Amz-Expires')).toBe('300');
      // A signed content-type is what stops a URL issued for image/jpeg from
      // accepting an HTML page or a script.
      expect(queryParam(target.uploadUrl, 'X-Amz-SignedHeaders')).toContain(
        'content-type',
      );
    });

    it('never builds the object key from the client-supplied filename', async () => {
      const res = await requestUpload(reporter.token, {
        filename: '../../etc/passwd.jpg',
        contentType: 'image/jpeg',
      });
      expect(res.status).toBe(201);
      const { objectKey } = res.body as UploadTarget;
      expect(objectKey).toMatch(OBJECT_KEY);
      expect(objectKey).not.toContain('passwd');
    });

    it.each(['text/html', 'application/pdf', 'image/svg+xml'])(
      'rejects the non-image content type %s with a readable 400',
      async (contentType) => {
        const res = await requestUpload(reporter.token, {
          filename: 'x',
          contentType,
        });
        expect(res.status).toBe(400);
        expect(String((res.body as { message: string }).message)).toMatch(
          /Unsupported content type/,
        );
      },
    );

    it('rejects a request missing the content type', async () => {
      const res = await requestUpload(reporter.token, { filename: 'x.jpg' });
      expect(res.status).toBe(400);
    });
  });

  describe('upload → retrieve round trip', () => {
    it('stores the uploaded bytes and serves them back within 3 seconds (SRS 3.3.2)', async () => {
      const target = (await requestUpload(reporter.token)).body as UploadTarget;

      const put = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: JPEG_BYTES,
      });
      expect(put.status).toBe(200);
      const uploadedAt = Date.now();

      const incidentId = await fx.incident({ reporterId: reporter.id });
      await fx.incidentImage(incidentId, target.mediaUrl);

      const res = await requestDownload(reporter.token, target.objectKey);
      expect(res.status).toBe(200);
      const { url } = res.body as { url: string };
      expect(queryParam(url, 'X-Amz-Expires')).toBe('900');

      const get = await fetch(url);
      const elapsedMs = Date.now() - uploadedAt;
      expect(get.status).toBe(200);
      expect(Buffer.from(await get.arrayBuffer())).toEqual(JPEG_BYTES);
      expect(elapsedMs).toBeLessThan(3000);
    });
  });

  describe('GET /media/:objectKey authorisation', () => {
    it('returns 404 for a key not attached to anything', async () => {
      const res = await requestDownload(
        otherCitizen.token,
        `${crypto.randomUUID()}.jpg`,
      );
      expect(res.status).toBe(404);
    });

    it("hides a photo on another organisation's non-public incident", async () => {
      const objectKey = `${crypto.randomUUID()}.jpg`;
      const hidden = await fx.incident({
        reporterId: reporter.id,
        organisationId: orgB,
        verificationStatus: 'rejected',
      });
      await fx.incidentImage(hidden, `http://store.test/bucket/${objectKey}`);

      expect(
        (await requestDownload(otherCitizen.token, objectKey)).status,
      ).toBe(404);
      // ...while the citizen who reported it can still open their own photo.
      expect((await requestDownload(reporter.token, objectKey)).status).toBe(
        200,
      );
    });

    it('serves a photo on a public-map incident to any signed-in user', async () => {
      const objectKey = `${crypto.randomUUID()}.jpg`;
      const onMap = await fx.incident({
        reporterId: reporter.id,
        organisationId: orgB,
      });
      await fx.incidentImage(onMap, `http://store.test/bucket/${objectKey}`);

      expect(
        (await requestDownload(otherCitizen.token, objectKey)).status,
      ).toBe(200);
    });
  });
});
