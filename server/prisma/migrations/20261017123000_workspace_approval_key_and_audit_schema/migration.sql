DROP INDEX "Approval_idempotencyKey_key";
CREATE UNIQUE INDEX "Approval_workspaceId_idempotencyKey_key"
ON "Approval" ("workspaceId", "idempotencyKey");

ALTER TABLE "AuditEvent" DROP COLUMN "updatedAt";
