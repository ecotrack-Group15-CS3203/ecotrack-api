import request from 'supertest';
import { PushNotificationsService } from '../src/modules/notifications/push-notifications.service';
import { Fixtures, FixtureUser } from './support/fixtures';
import { createTestApp, TestApp } from './support/test-app';

/**
 * In-app and push notifications (SRS 3.1.4, 3.1.8), driven by real actions
 * through the HTTP API.
 *
 * Every notification is stored first; push is a best-effort copy sent after the
 * request's own work, and must never hold it up or fail it. Expo itself is out of
 * scope — PushNotificationsService is replaced by a mock that records what would
 * have been sent (its own Expo handling is covered by its unit spec). Push delivery
 * to a real phone was checked manually on a development build.
 */

const PUSH_TOKEN = 'ExponentPushToken[e2e-notifications]';

/** The push runs after the response is sent, so wait for it rather than assume. */
async function eventually(assertion: () => void, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

/** For "nothing was sent": give a stray push time to show up before concluding. */
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('Notifications (e2e)', () => {
  let t: TestApp;
  let fx: Fixtures;
  const send = jest.fn<
    Promise<void>,
    Parameters<PushNotificationsService['send']>
  >();

  let org: string;
  let admin: FixtureUser;
  let volunteer: FixtureUser;

  beforeAll(async () => {
    t = await createTestApp({
      configure: (b) =>
        b.overrideProvider(PushNotificationsService).useValue({ send }),
    });
    fx = new Fixtures('notify', t.jwks);
    await fx.setup();

    org = await fx.org('org');
    await fx.workflowStages(org);
    admin = await fx.user('admin', { role: 'org_admin', organisationId: org });
    volunteer = await fx.user('volunteer', {
      role: 'volunteer',
      organisationId: org,
    });
  });

  afterAll(async () => {
    await fx.close();
    await t.close();
  });

  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue(undefined);
  });

  const as = (user: FixtureUser) => ({
    patch: (path: string) =>
      request(t.server)
        .patch(path)
        .set('Authorization', `Bearer ${user.token}`),
    post: (path: string) =>
      request(t.server).post(path).set('Authorization', `Bearer ${user.token}`),
    get: (path: string) =>
      request(t.server).get(path).set('Authorization', `Bearer ${user.token}`),
  });

  const registerPushToken = async (user: FixtureUser) =>
    expect(
      (await as(user).patch('/auth/push-token').send({ pushToken: PUSH_TOKEN }))
        .status,
    ).toBe(200);

  /** A new pooled report by `reporter`, claimed by the org over HTTP. */
  const claimNewReport = async (reporter: FixtureUser) => {
    const incidentId = await fx.incident({ reporterId: reporter.id });
    const res = await as(admin)
      .post(`/incidents/pool/${incidentId}/claim`)
      .send();
    expect(res.status).toBe(200);
    return incidentId;
  };

  type NotificationItem = {
    id: string;
    type: string;
    title: string;
    isRead: boolean;
    relatedEntityId: string;
  };
  const inbox = async (user: FixtureUser) =>
    (
      (await as(user).get('/notifications')).body as {
        items: NotificationItem[];
      }
    ).items;

  describe('push token registration', () => {
    it("stores the device's Expo push token against the user", async () => {
      const citizen = await fx.user('registers-token');
      await registerPushToken(citizen);
      const { rows } = await fx.db.query<{ push_token: string }>(
        'SELECT push_token FROM users WHERE id = $1',
        [citizen.id],
      );
      expect(rows[0].push_token).toBe(PUSH_TOKEN);
    });

    it('rejects an empty token', async () => {
      const citizen = await fx.user('empty-token');
      const res = await as(citizen)
        .patch('/auth/push-token')
        .send({ pushToken: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('an incident being claimed notifies its reporter', () => {
    it('stores an in-app notification and pushes it to their device', async () => {
      const reporter = await fx.user('reporter-with-device');
      await registerPushToken(reporter);
      const incidentId = await claimNewReport(reporter);

      const [notification] = await inbox(reporter);
      expect(notification).toMatchObject({
        type: 'incident_claimed',
        title: 'Your report was claimed',
        isRead: false,
        relatedEntityId: incidentId,
      });

      await eventually(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        PUSH_TOKEN,
        'Your report was claimed',
        expect.stringContaining('has been claimed'),
        // What the mobile app reads on tap to open the right screen.
        {
          type: 'incident_claimed',
          relatedEntityType: 'incident',
          relatedEntityId: incidentId,
        },
      );
    });

    it('still stores the notification when the reporter has no device registered', async () => {
      const reporter = await fx.user('reporter-no-device');
      await claimNewReport(reporter);

      expect(await inbox(reporter)).toHaveLength(1);
      await settle();
      expect(send).not.toHaveBeenCalled();
    });

    it('completes the claim even if push delivery fails outright', async () => {
      send.mockRejectedValue(new Error('Expo unreachable'));
      const reporter = await fx.user('reporter-push-fails');
      await registerPushToken(reporter);
      await claimNewReport(reporter);

      expect(await inbox(reporter)).toHaveLength(1);
      await eventually(() => expect(send).toHaveBeenCalled());
    });
  });

  describe('notification preferences (SRS 3.1.8)', () => {
    let reporter: FixtureUser;

    beforeAll(async () => {
      await registerPushToken(volunteer);
      reporter = await fx.user('task-reporter');
    });

    // A fresh claimed incident per task: creating a task advances the incident off
    // the required stage, so the same incident can't take a second one.
    const assignTask = async (title: string) => {
      const incidentId = await claimNewReport(reporter);
      const res = await as(admin)
        .post(`/organisations/${org}/tasks`)
        .send({
          incidentId,
          title,
          assignedTo: volunteer.id,
          dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        });
      expect(res.status).toBe(201);
    };

    it('pushes a task assignment while the preference is on (the default)', async () => {
      await assignTask('Clear the canal bank');
      await eventually(() =>
        expect(send).toHaveBeenCalledWith(
          PUSH_TOKEN,
          'New cleanup task assigned',
          'You have been assigned to: Clear the canal bank',
          expect.objectContaining({ type: 'task_assigned' }),
        ),
      );
    });

    it('stops pushing task assignments once the volunteer turns the preference off, but keeps them in-app', async () => {
      const off = await as(volunteer)
        .patch('/auth/me')
        .send({ notificationPreferences: { taskAssigned: false } });
      expect(off.status).toBe(200);

      await assignTask('Collect the plastic');
      expect((await inbox(volunteer)).map((n) => n.title)).toContain(
        'New cleanup task assigned',
      );
      await settle();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('reading notifications', () => {
    it("shows each user only their own notifications, and won't let anyone mark another's as read", async () => {
      const owner = await fx.user('inbox-owner');
      await claimNewReport(owner);
      const [mine] = await inbox(owner);

      const stranger = await fx.user('inbox-stranger');
      expect(await inbox(stranger)).toEqual([]);
      const res = await as(stranger)
        .patch(`/notifications/${mine.id}/read`)
        .send();
      // RLS hides the row entirely, so it is "not found" rather than "forbidden".
      expect(res.status).toBe(404);
      expect((await inbox(owner))[0].isRead).toBe(false);
    });

    it('marks one, then all, as read', async () => {
      const user = await fx.user('reader');
      await claimNewReport(user);
      await claimNewReport(user);
      const [first] = await inbox(user);

      expect(
        (await as(user).patch(`/notifications/${first.id}/read`).send()).status,
      ).toBe(200);
      const all = await as(user).patch('/notifications/read-all').send();
      expect(all.body).toEqual({ updated: 1 });
      expect((await inbox(user)).every((n) => n.isRead)).toBe(true);
    });
  });
});
