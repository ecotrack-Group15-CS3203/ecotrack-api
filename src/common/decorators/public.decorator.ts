import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a route out of the global JwtAuthGuard (e.g. register/login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
