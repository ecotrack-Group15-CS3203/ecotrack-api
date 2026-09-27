import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { TenantDbService } from '../../database/tenant-db.service';
import { createFakeDb, FakeDb } from '../../test-utils/fake-db';
import { AuditLogService } from '../audit/audit-log.service';
import { UsersService } from '../users/users.service';
import { InviteLinksService } from './invite-links.service';

/** SRS 3.4.7 token security and 3.1.12 redemption rules, in the service's own order. */
describe('InviteLinksService', () => {
  let fake: FakeDb;
  let users: { findById: jest.Mock; setMembership: jest.Mock };
  let service: InviteLinksService;
  const inFuture = new Date(Date.now() + 86_400_000);
  const link = (over: Record<string, unknown> = {}) => ({
    inviteLink: {
      id: 'link',
      organisationId: 'org',
      maxUses: null,
      usesCount: 0,
      expiresAt: inFuture,
      revokedAt: null,
      ...over,
    },
    organisationName: 'Kelani Cleanup',
    serviceAreaCenter: { lat: 6.9271, lng: 79.8612 },
    serviceAreaRadiusKm: 25,
  });
  const COLOMBO = { lat: 6.93, lng: 79.86 };

  beforeEach(() => {
    fake = createFakeDb();
    users = {
      findById: jest.fn().mockResolvedValue({ organisationId: null }),
      setMembership: jest.fn(),
    };
    service = new InviteLinksService(
      { db: fake.db } as unknown as TenantDbService,
      { record: jest.fn() } as unknown as AuditLogService,
      users as unknown as UsersService,
    );
    // Token lookup sets its RLS flag first, then (if reached) the ST_DWithin check.
    fake.db.execute.mockResolvedValueOnce({ rows: [] });
  });

  it('generates a 128-bit token and stores only its SHA-256 hash, expiring in 7 days', async () => {
    fake.nextResult([{ id: 'link' }]);
    const { token } = await service.generate('org', {}, 'admin');

    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
    const stored = fake.calls.find((c) => c.method === 'values')!.args[0] as {
      tokenHash: string;
      expiresAt: Date;
    };
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(JSON.stringify(stored)).not.toContain(token);
    const days = (stored.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
  });

  it('returns 404 for an unknown token', async () => {
    fake.nextResult([]);
    await expect(service.accept('nope', 'u', COLOMBO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    [
      'revoked',
      { revokedAt: new Date() },
      'This invite link has been revoked.',
    ],
    [
      'expired',
      { expiresAt: new Date(Date.now() - 1000) },
      'This invite link has expired.',
    ],
    [
      'exhausted',
      { maxUses: 2, usesCount: 2 },
      'This invite link has reached its usage limit.',
    ],
  ])('refuses a %s link', async (_case, over, message) => {
    fake.nextResult([link(over)]);
    await expect(service.accept('t', 'u', COLOMBO)).rejects.toThrow(
      new BadRequestException(message),
    );
  });

  it('refuses a user outside the service area (422)', async () => {
    fake.nextResult([link()]);
    fake.db.execute.mockResolvedValueOnce({ rows: [{ within: false }] });
    await expect(service.accept('t', 'u', COLOMBO)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('refuses a user who already belongs to an organisation (409)', async () => {
    fake.nextResult([link()]);
    fake.db.execute.mockResolvedValueOnce({ rows: [{ within: true }] });
    users.findById.mockResolvedValue({ organisationId: 'other-org' });
    await expect(service.accept('t', 'u', COLOMBO)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses the loser of a race for the last use (atomic update matched nothing)', async () => {
    fake.nextResult([link({ maxUses: 1, usesCount: 0 })]);
    fake.db.execute.mockResolvedValueOnce({ rows: [{ within: true }] });
    fake.nextResult([]); // conditional UPDATE ... WHERE uses_count < max_uses
    await expect(service.accept('t', 'u', COLOMBO)).rejects.toThrow(
      new BadRequestException('This invite link has reached its usage limit.'),
    );
    expect(users.setMembership).not.toHaveBeenCalled();
  });

  it('grants volunteer membership when every check passes', async () => {
    fake.nextResult([link()]);
    fake.db.execute.mockResolvedValueOnce({ rows: [{ within: true }] });
    fake.nextResult([{ id: 'link', usesCount: 1 }]);
    await expect(service.accept('t', 'u', COLOMBO)).resolves.toEqual({
      organisationId: 'org',
      role: 'volunteer',
    });
    expect(users.setMembership).toHaveBeenCalledWith(
      'u',
      'org',
      'volunteer',
      COLOMBO,
    );
  });
});
