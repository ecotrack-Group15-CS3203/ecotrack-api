import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { JwtStrategy, MAX_ACCESS_TOKEN_LIFETIME_SECONDS } from './jwt.strategy';

// validate() runs after signature verification, so the key lookup is never reached
// here — and the real module pulls in ESM-only `jose`, which this Jest config does
// not transform.
jest.mock('jwks-rsa', () => ({ passportJwtSecret: () => () => undefined }));

const config = {
  get: (key: string) => ({ OIDC_JWKS_URI: 'http://127.0.0.1:1/jwks' })[key],
} as unknown as ConfigService;

const provisionedUser = {
  id: 'user-1',
  authSubject: 'sub-1',
  email: 'a@example.com',
  fullName: 'A',
  role: 'citizen',
  organisationId: null,
  isPlatformAdmin: false,
  isActive: true,
};

describe('JwtStrategy.validate — access token lifetime (SRS 3.4.6)', () => {
  let findOrProvision: jest.Mock;
  let strategy: JwtStrategy;

  beforeEach(() => {
    findOrProvision = jest.fn().mockResolvedValue(provisionedUser);
    strategy = new JwtStrategy(config, {
      findOrProvisionByAuthSubject: findOrProvision,
    } as unknown as UsersService);
  });

  const now = () => Math.floor(Date.now() / 1000);
  const payload = (lifetimeSeconds: number) => ({
    sub: 'sub-1',
    email: 'a@example.com',
    iat: now(),
    exp: now() + lifetimeSeconds,
  });

  it("accepts a token with Asgardeo's configured 1-hour lifetime", async () => {
    await expect(
      strategy.validate(payload(MAX_ACCESS_TOKEN_LIFETIME_SECONDS)),
    ).resolves.toMatchObject({ id: 'user-1' });
  });

  it('rejects a token that lives longer than one hour, as TOKEN_INVALID', async () => {
    const rejection = strategy.validate(payload(24 * 3600));
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(rejection).rejects.toMatchObject({
      response: { code: 'TOKEN_INVALID' },
    });
  });

  it('does not provision a user from a rejected token', async () => {
    await expect(strategy.validate(payload(2 * 3600))).rejects.toThrow();
    expect(findOrProvision).not.toHaveBeenCalled();
  });
});
