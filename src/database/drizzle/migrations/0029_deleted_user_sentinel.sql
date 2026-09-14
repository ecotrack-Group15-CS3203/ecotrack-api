-- SRS 3.11.1's right to erasure: deleting an account must NOT cascade-delete the
-- incident/task history it's attached to. Most of that is already free —
-- incidents.reported_by_user_id, incidents.claimed_by_user_id,
-- tasks.created_by_user_id, task_notes.author_user_id, task_photos.uploaded_by_
-- user_id, events.created_by_user_id, invite_links.created_by_user_id,
-- invitations.invited_by_user_id and audit_logs.acting_user_id are all
-- ON DELETE SET NULL, so deleting the row anonymises those references
-- automatically. The one exception is task_assignments.volunteer_user_id
-- (ON DELETE CASCADE, NOT NULL) — cascading it away would erase "who completed
-- this task", which is exactly the record 3.1.20's audit trail exists to keep.
-- UsersService.deleteAccount() reassigns those rows to this sentinel before
-- deleting the real row.
INSERT INTO "users" (
  "id", "auth_subject", "email", "full_name", "role", "is_active"
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system:deleted-user',
  'deleted@ecotrack.invalid',
  'Deleted User',
  'citizen',
  false
)
ON CONFLICT ("id") DO NOTHING;
