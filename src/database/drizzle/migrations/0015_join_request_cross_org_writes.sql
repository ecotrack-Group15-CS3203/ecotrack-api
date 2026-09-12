-- Caught by the same live-testing discipline that found A9's audit_logs gap, this
-- time before it ever hit a real request: JoinRequestsService.submit() needs to
-- write two rows scoped to the TARGET organisation while the submitting citizen's
-- own tenant is empty — a notification addressed to each of that org's admins, and
-- an audit_logs entry. Neither the citizen's own user_id nor their (empty) tenant
-- satisfies either policy's existing WITH CHECK.
--
-- Unlike invite_links/invitations (authorized by a secret token) there's no token
-- here, so this gets its own honestly-named flag rather than overloading
-- app.invitation_token_lookup for something structurally different. Set once by
-- JoinRequestsService.submit() right before these two writes.
DROP POLICY "notifications_insert" ON "notifications";

CREATE POLICY "notifications_insert" ON "notifications"
  FOR INSERT
  WITH CHECK (
    "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.join_request_submission', true)::boolean IS TRUE
  );

DROP POLICY "tenant_isolation" ON "audit_logs";

CREATE POLICY "tenant_isolation" ON "audit_logs"
  USING (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
    OR current_setting('app.join_request_submission', true)::boolean IS TRUE
  )
  WITH CHECK (
    "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR "organisation_id" IS NULL
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
    OR current_setting('app.invitation_token_lookup', true)::boolean IS TRUE
    OR current_setting('app.join_request_submission', true)::boolean IS TRUE
  );
