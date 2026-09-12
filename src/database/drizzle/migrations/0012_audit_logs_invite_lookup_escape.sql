-- Found live while testing A9: InviteLinksService.accept() legitimately writes an
-- audit_logs row scoped to the invite link's organisation, but the caller (a citizen
-- with no organisation of their own, app.current_tenant = '') has no tenant match and
-- no platform-admin flag, so the existing WITH CHECK rejected it with a bare 42501 --
-- the exact same class of cross-tenant write the invitations/invite_links policies
-- already carve out for via app.invitation_token_lookup, just never extended to
-- audit_logs because nothing needed to write a *log entry* across that boundary
-- until now (InvitationsService.acceptForUser() never logs the acceptance at all).
--
-- Postgres has no ALTER POLICY for USING/WITH CHECK clauses, so this drops and
-- recreates 0003's policy verbatim plus the one added clause on each side.
DROP POLICY "tenant_isolation" ON "audit_logs";

CREATE POLICY "tenant_isolation" ON "audit_logs"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "organisation_id" IS NULL
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
  );
