-- Reordering workflow stages returned 500 for every real reorder (found by the Cypress
-- E2E suite): WorkflowStagesService.reorderStages() rewrites each stage's position one
-- row at a time, and a non-deferrable UNIQUE constraint is checked per row, so the
-- first swap collides with the stage still holding the target position - even though
-- the final order is valid. Deleting a stage renumbers the rest the same way.
--
-- Deferred to COMMIT, uniqueness is checked once against the finished order. Every
-- request runs in one transaction (TenantInterceptor), so a reorder or renumber either
-- ends valid or rolls back whole.
ALTER TABLE "workflow_stages" DROP CONSTRAINT "workflow_stages_org_position_unique";
--> statement-breakpoint
ALTER TABLE "workflow_stages"
  ADD CONSTRAINT "workflow_stages_org_position_unique"
  UNIQUE ("organisation_id", "position") DEFERRABLE INITIALLY DEFERRED;
