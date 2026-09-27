/**
 * The one place expo-server-sdk is loaded. It ships ESM-only, so it is pulled in with
 * a dynamic import() — see PushNotificationsService. Kept in its own module so tests
 * can jest.mock() it: Jest (without --experimental-vm-modules) cannot execute a
 * native import(), but it can replace the module that contains one.
 */
export const loadExpoSdk = () => import('expo-server-sdk');
