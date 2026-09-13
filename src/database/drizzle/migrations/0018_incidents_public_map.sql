-- GET /v1/incidents/nearby (SRS 3.1.3) is the citizen-facing hazard map: it shows
-- incidents near a point regardless of which organisation, if any, has claimed them.
-- That is deliberately not tenant-filtered — public hazard awareness is the whole
-- point of the feature, and SAD 8.2 specifies it that way.
--
-- `tenant_isolation` cannot serve it. A citizen has app.current_tenant = '' and
-- app.is_org_admin = 'false', so that policy narrows to "incidents I reported
-- myself". Running the query on the pool-wide connection doesn't help either:
-- ecotrack_app is NOBYPASSRLS, so with every session variable unset each clause is
-- NULL and the query returns nothing at all.
--
-- So this adds a SECOND, SELECT-ONLY permissive policy, gated on a flag the service
-- sets transaction-locally immediately before the query. Postgres ORs permissive
-- policies together, so this can only ever widen reads — UPDATE and DELETE still have
-- to satisfy tenant_isolation's USING clause, which is untouched below. A SELECT-only
-- policy is structurally incapable of authorising a write.
--
-- Same shape as the app.invitation_token_lookup escape hatch in 0003/0011/0012, and
-- named for what it actually permits rather than reusing that flag for something
-- unrelated (the precedent 0015 set with app.join_request_submission).
CREATE POLICY "incidents_public_map" ON "incidents"
  FOR SELECT
  USING (current_setting('app.public_map_read', true)::boolean IS TRUE);
