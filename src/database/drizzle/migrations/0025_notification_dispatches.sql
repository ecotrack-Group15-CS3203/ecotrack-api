-- The outbox table backing three deferred/fan-out notification triggers the SRS
-- specifies (3.1.4's incident-proximity match, 3.1.8's task due-date reminder,
-- 3.1.9's event reminder), all handled by one cron rather than three, and all
-- sharing the same idempotency guarantee.
--
-- Deliberately NOT RLS-protected: it carries no tenant-readable content (an
-- entity_id and a kind, nothing else), is never exposed through any endpoint, and
-- its only reader is the tenantless dispatch cron running via SystemDbService. RLS
-- exists to scope what a *user session* can see; there is no user session here.
CREATE TABLE "notification_dispatches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" varchar NOT NULL,
  "entity_type" varchar NOT NULL,
  "entity_id" uuid NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  -- NULL = pending. Set BEFORE the handler runs (see NotificationDispatchService),
  -- not after — that ordering is what makes a crash mid-batch lose pushes rather
  -- than duplicate them, the correct failure mode for a reminder.
  "dispatched_at" timestamp with time zone,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- One reminder of a given kind for a given entity, ever. Rescheduling (e.g. a
  -- task's due date edited) is an upsert on this constraint, guarded so it can
  -- never resurrect an already-sent reminder — see the ON CONFLICT clauses in
  -- TasksService/EventsService.
  CONSTRAINT "notification_dispatches_kind_entity_unique" UNIQUE ("kind", "entity_id")
);

-- The cron's only query is "pending rows due now" — a partial index over exactly
-- that predicate, rather than indexing dispatched_at values nothing ever asks for.
CREATE INDEX "notification_dispatches_pending_idx"
  ON "notification_dispatches" ("due_at")
  WHERE "dispatched_at" IS NULL;
