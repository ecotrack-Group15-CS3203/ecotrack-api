-- Notifications are, by definition, written by one actor FOR a different user: an
-- org_admin claiming a pooled incident notifies the citizen who reported it, assigning
-- a task notifies the volunteer, and so on. The original single FOR ALL policy required
-- `user_id = app.current_user_id` on writes as well as reads, which made every one of
-- those inserts fail with "new row violates row-level security policy" — claim, reject
-- and task-assignment alike.
--
-- Splitting per command keeps read isolation exactly as strict as before (you still see
-- only your own notifications) while allowing a session to create one for somebody else
-- provided it stamps its own tenant on the row.

DROP POLICY IF EXISTS "user_isolation" ON "notifications";

-- Reads stay strictly per-user: nobody reads anyone else's notifications, ever.
CREATE POLICY "notifications_select" ON "notifications"
  FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Writes: your own, or one addressed to any user but attributed to your own tenant.
-- The tenant stamp is what bounds this — a session cannot forge a notification that
-- appears to come from another organisation.
CREATE POLICY "notifications_insert" ON "notifications"
  FOR INSERT
  WITH CHECK (
    "user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR "organisation_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR current_setting('app.is_platform_admin', true)::boolean IS TRUE
  );

-- Marking read/unread is only ever done by the recipient.
CREATE POLICY "notifications_update" ON "notifications"
  FOR UPDATE
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY "notifications_delete" ON "notifications"
  FOR DELETE
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
