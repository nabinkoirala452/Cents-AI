-- Remove seeded operation claims because none of the represented actions occurred.
ALTER TABLE "AuditEvent" DISABLE TRIGGER "AuditEvent_append_only";

DELETE FROM "AuditEvent"
WHERE "workspaceId" = 'centsai-demo'
  AND "id" IN ('AU-2', 'AU-3', 'AU-4', 'AU-5', 'AU-6', 'AU-7', 'AU-8', 'AU-9');

ALTER TABLE "AuditEvent" ENABLE TRIGGER "AuditEvent_append_only";
