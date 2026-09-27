import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushNotificationsService } from './push-notifications.service';

/**
 * Push is a best-effort channel on top of the stored in-app notification (SRS
 * 3.1.4, 3.1.8): these tests pin down that a message goes out in Expo's format
 * when it can, and that nothing Expo does — rejecting a ticket, or failing
 * outright — ever reaches the caller.
 *
 * The real SDK is ESM-only and would call Expo's servers; it is replaced here.
 */
const sendPushNotificationsAsync = jest.fn();
const expoConstructor = jest.fn();

jest.mock('./expo-sdk.loader', () => ({
  loadExpoSdk: () => Promise.resolve({ Expo: MockExpo }),
}));

class MockExpo {
  static isExpoPushToken = (token: string) =>
    /^Expo(nent)?PushToken\[.+\]$/.test(token);
  sendPushNotificationsAsync = sendPushNotificationsAsync;
  constructor(options: unknown) {
    expoConstructor(options);
  }
}

const TOKEN = 'ExponentPushToken[abc123]';

describe('PushNotificationsService', () => {
  let warn: jest.SpyInstance;
  const service = (env: Record<string, string> = {}) =>
    new PushNotificationsService({
      get: (key: string) => env[key],
    } as unknown as ConfigService);

  beforeEach(() => {
    sendPushNotificationsAsync.mockReset();
    expoConstructor.mockReset();
    sendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 't1' }]);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => warn.mockRestore());

  it('sends one message in Expo format, carrying the routing payload', async () => {
    await service().send(TOKEN, 'Title', 'Body', {
      relatedEntityType: 'task',
      relatedEntityId: 'task-1',
    });

    expect(sendPushNotificationsAsync).toHaveBeenCalledWith([
      {
        to: TOKEN,
        title: 'Title',
        body: 'Body',
        data: { relatedEntityType: 'task', relatedEntityId: 'task-1' },
        sound: 'default',
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('authenticates with EXPO_ACCESS_TOKEN when one is configured', async () => {
    await service({ EXPO_ACCESS_TOKEN: 'secret' }).send(TOKEN, 'T', 'B');
    expect(expoConstructor).toHaveBeenCalledWith({ accessToken: 'secret' });
  });

  it('creates the Expo client once and reuses it', async () => {
    const s = service();
    await s.send(TOKEN, 'T', 'B');
    await s.send(TOKEN, 'T', 'B');
    expect(expoConstructor).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no token', null],
    ['a token that is not an Expo push token', 'not-a-push-token'],
  ])('sends nothing for %s', async (_case, token) => {
    await service().send(token, 'T', 'B');
    expect(sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('logs, and does not throw, when Expo rejects the message', async () => {
    sendPushNotificationsAsync.mockResolvedValue([
      {
        status: 'error',
        message: 'not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);
    await expect(service().send(TOKEN, 'T', 'B')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not registered'),
    );
  });

  it('logs, and does not throw, when Expo cannot be reached', async () => {
    sendPushNotificationsAsync.mockRejectedValue(new Error('ECONNRESET'));
    await expect(service().send(TOKEN, 'T', 'B')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'));
  });
});
