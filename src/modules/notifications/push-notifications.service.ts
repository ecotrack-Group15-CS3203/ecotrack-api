import { Injectable, Logger } from '@nestjs/common';
import type { Expo as ExpoInstance, ExpoPushMessage } from 'expo-server-sdk';

type ExpoModule = typeof import('expo-server-sdk');

/**
 * Thin wrapper around Expo's push service. Failures here must never affect
 * the caller — in-app notifications (persisted rows, FR-NOT-02) are the
 * source of truth; push is a best-effort delivery channel on top.
 *
 * expo-server-sdk ships ESM-only (no CJS build). This project's runtime
 * (ts-node under "module": "nodenext") loads a static import of it fine,
 * but Jest's CJS-only transform can't parse it even when whitelisted via
 * transformIgnorePatterns. A dynamic import() is the standard Node interop
 * for a CJS-context caller depending on an ESM-only package, and it also
 * sidesteps Jest's static-analysis transform entirely (dynamic import is
 * just a function call syntactically).
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private client: { Expo: ExpoModule['Expo']; instance: ExpoInstance } | null =
    null;

  private async getClient() {
    if (!this.client) {
      const { Expo } = await import('expo-server-sdk');
      this.client = { Expo, instance: new Expo() };
    }
    return this.client;
  }

  async send(
    pushToken: string | null,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!pushToken) return;
    try {
      const { Expo, instance } = await this.getClient();
      if (!Expo.isExpoPushToken(pushToken)) return;

      const message: ExpoPushMessage = {
        to: pushToken,
        title,
        body,
        data,
        sound: 'default',
      };
      const tickets = await instance.sendPushNotificationsAsync([message]);
      const errorTicket = tickets.find((t) => t.status === 'error');
      if (errorTicket && errorTicket.status === 'error') {
        this.logger.warn(
          `Push delivery error for token ${pushToken}: ${errorTicket.message}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Push send failed: ${(err as Error).message}`);
    }
  }
}
