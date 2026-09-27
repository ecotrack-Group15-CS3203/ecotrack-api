import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantDbService } from '../../database/tenant-db.service';
import { createFakeDb, FakeDb } from '../../test-utils/fake-db';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { OrganisationMembersService } from './organisation-members.service';
import { JoinRequestsService } from './join-requests.service';

/** SRS 3.1.11 join requests: the checks a submission passes, in order. */
describe('JoinRequestsService.submit', () => {
  let fake: FakeDb;
  let users: { findById: jest.Mock; setHomeLocation: jest.Mock };
  let members: { listMembers: jest.Mock };
  let notifications: { create: jest.Mock };
  let service: JoinRequestsService;
  const org = {
    id: 'org',
    name: 'Kelani Cleanup',
    serviceAreaCenter: { lat: 6.9271, lng: 79.8612 },
    serviceAreaRadiusKm: 25,
  };
  const request = { organisationId: 'org', lat: 6.93, lng: 79.86 };

  beforeEach(() => {
    fake = createFakeDb();
    users = {
      findById: jest.fn().mockResolvedValue({ organisationId: null }),
      setHomeLocation: jest.fn(),
    };
    members = { listMembers: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) };
    notifications = { create: jest.fn() };
    service = new JoinRequestsService(
      { db: fake.db } as unknown as TenantDbService,
      { record: jest.fn() } as unknown as AuditLogService,
      users as unknown as UsersService,
      members as unknown as OrganisationMembersService,
      notifications as unknown as NotificationsService,
    );
    fake.db.query.organisations.findFirst.mockResolvedValue(org);
    fake.db.query.joinRequests.findFirst.mockResolvedValue(undefined);
  });

  it('returns 404 for an unknown organisation', async () => {
    fake.db.query.organisations.findFirst.mockResolvedValue(undefined);
    await expect(service.submit('u', request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses an organisation with no service area configured', async () => {
    fake.db.query.organisations.findFirst.mockResolvedValue({
      ...org,
      serviceAreaCenter: null,
    });
    await expect(service.submit('u', request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses an applicant outside the service area (422)', async () => {
    fake.db.execute.mockResolvedValueOnce({ rows: [{ within: false }] });
    await expect(service.submit('u', request)).rejects.toThrow(
      new UnprocessableEntityException(
        "You are outside Kelani Cleanup's service area.",
      ),
    );
  });

  it('refuses an applicant who already belongs to an organisation (409)', async () => {
    fake.db.execute.mockResolvedValueOnce({ rows: [{ within: true }] });
    users.findById.mockResolvedValue({ organisationId: 'other' });
    await expect(service.submit('u', request)).rejects.toThrow(
      new ConflictException('Already a member of another organisation.'),
    );
  });

  it('refuses a duplicate while an earlier request is pending (409)', async () => {
    fake.db.execute.mockResolvedValueOnce({ rows: [{ within: true }] });
    fake.db.query.joinRequests.findFirst.mockResolvedValue({
      status: 'pending',
    });
    await expect(service.submit('u', request)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('records the request and notifies every org admin', async () => {
    fake.db.execute.mockResolvedValue({ rows: [{ within: true }] });
    fake.nextResult([{ id: 'jr-1', status: 'pending' }]);
    await service.submit('u', request);
    expect(fake.calls.some((c) => c.method === 'insert')).toBe(true);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1' }),
    );
    expect(users.setHomeLocation).toHaveBeenCalled();
  });
});
