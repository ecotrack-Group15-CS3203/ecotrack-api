/**
 * Shape of the validated Asgardeo access token. `role`/`organizationId` are read as
 * custom claims (configured in the Asgardeo console per Milestone 1) but are NOT
 * trusted directly for authorization — JwtStrategy.validate() re-resolves the
 * authoritative role/org from EcoTrack's own `users` row on every request instead
 * (see that file's doc comment). They're only used here to seed a brand-new user's
 * initial `fullName`/`email` on first-ever sight of a given `sub`.
 */
export interface AsgardeoJwtPayload {
  sub: string;
  /**
   * Optional on the wire even though EcoTrack requires it: Asgardeo omits `email` from
   * access tokens unless it is added to the application's Access Token Attributes.
   * JwtStrategy.validate() rejects the request with a message naming that fix rather
   * than assuming it is present.
   */
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  iat: number;
  exp: number;
}
