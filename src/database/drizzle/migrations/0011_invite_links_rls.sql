-- invite_links: same shape as invitations' policy in 0003_app_role_and_rls.sql —
-- org-scoped for admin listing/creation/revocation, plus the same
-- app.invitation_token_lookup escape hatch for the one legitimate cross-tenant path:
-- redeeming a link by its token has nothing to do with org membership, the secret
-- token itself (hashed, SHA-256, SRS 3.4.7) IS the authorization.
ALTER TABLE "invite_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invite_links" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "invite_links"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    -- Needed for the write side of redemption too (incrementing uses_count) —
    -- not just the read side above. Scoped to the same narrow, explicitly-set flag.
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
  );
