import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const TOKEN_MISSING = 'TOKEN_MISSING';
export const TOKEN_EXPIRED = 'TOKEN_EXPIRED';
export const TOKEN_INVALID = 'TOKEN_INVALID';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Passport's default is a bare 401 for every failure mode. The mobile client needs
   * to tell them apart: only `TOKEN_EXPIRED` should trigger its silent-refresh retry —
   * retrying a malformed or absent token just loops. So the failure reason is
   * classified here and surfaced as a stable `code` alongside the message.
   *
   * `info` is what passport-jwt reports the failure as: a `TokenExpiredError` /
   * `JsonWebTokenError` from jsonwebtoken, or a plain Error("No auth token") when the
   * Authorization header is absent or unparseable.
   */
  handleRequest<TUser>(
    err: Error | null,
    user: TUser | false,
    info: (Error & { name?: string }) | undefined,
  ): TUser {
    if (err) throw err;
    if (user) return user;

    if (info?.name === 'TokenExpiredError') {
      throw new UnauthorizedException({
        statusCode: 401,
        code: TOKEN_EXPIRED,
        message: 'Access token has expired',
      });
    }

    // passport-jwt reports a missing/unparseable Authorization header as a generic
    // Error rather than a typed one, so this matches on its message.
    if (!info || /no auth token/i.test(info.message ?? '')) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: TOKEN_MISSING,
        message: 'Authorization header is missing',
      });
    }

    throw new UnauthorizedException({
      statusCode: 401,
      code: TOKEN_INVALID,
      message: 'Access token is invalid',
    });
  }
}
