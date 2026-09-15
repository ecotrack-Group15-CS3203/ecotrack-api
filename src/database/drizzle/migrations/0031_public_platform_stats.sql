-- Platform-wide totals for the public landing page (GET /v1/public/stats).
--
-- Every row these numbers count sits behind RLS, and the landing page is public and
-- cross-tenant. A request handler must not borrow SystemDbService for this (it is
-- reserved for system-started jobs), so the database exposes exactly one row of
-- aggregates instead. The result type is fixed to counts: no caller can read a single
-- row of any table through this function.
--
-- Visibility: the counts need the policies' existing `app.is_platform_admin` branch,
-- so the function turns it on, runs the counts, and puts back whatever value the
-- caller had. The rest of the request's transaction keeps its own tenant scope. If a
-- count fails, the error aborts the whole transaction, which discards the setting
-- anyway.
--
-- Why not a `SET app.is_platform_admin = 'true'` clause on the function: Postgres only
-- lets a superuser attach a custom setting to a function, and the RDS master user that
-- runs migrations is not one. set_config() at run time needs no such privilege (the
-- API's TenantInterceptor sets these same variables on every request), and unlike
-- SECURITY DEFINER it doesn't depend on the owner bypassing FORCE ROW LEVEL SECURITY,
-- which no role can do on RDS.
--
-- The previous value is restored as 'false' when it was unset or empty: several
-- policies cast this variable straight to boolean, and ''::boolean is an error.
--
-- "Resolved" matches the dashboard (the incident's current stage is final), minus
-- dismissals: the default Dismissed stage is final too, and a rejected or duplicate
-- report is not a cleanup. Dismissed stages are recognised by their immutable slug,
-- and verification status is checked as well, in case an organisation has deleted
-- its Dismissed stage. `::text` keeps the comparison valid whatever the enum holds.
CREATE FUNCTION public_platform_stats()
RETURNS TABLE (
  organisations bigint,
  incidents_resolved bigint,
  claimed_count bigint,
  median_claim_minutes double precision
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  previous_platform_admin text :=
    coalesce(nullif(current_setting('app.is_platform_admin', true), ''), 'false');
BEGIN
  PERFORM set_config('app.is_platform_admin', 'true', true);

  RETURN QUERY
    SELECT
      (SELECT count(*) FROM organisations o WHERE o.is_active),
      (SELECT count(*)
         FROM incidents i
         JOIN workflow_stages s ON s.id = i.current_stage_id
        WHERE s.is_final
          AND s.slug <> 'dismissed'
          AND (i.verification_status IS NULL
               OR i.verification_status::text NOT IN ('rejected', 'duplicate'))),
      (SELECT count(*) FROM incidents i WHERE i.claimed_at IS NOT NULL),
      (SELECT (EXTRACT(EPOCH FROM
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY i.claimed_at - i.created_at)
               ) / 60)::double precision
         FROM incidents i
        WHERE i.claimed_at IS NOT NULL);

  PERFORM set_config('app.is_platform_admin', previous_platform_admin, true);
END;
$$;

REVOKE ALL ON FUNCTION public_platform_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_platform_stats() TO ecotrack_app;
