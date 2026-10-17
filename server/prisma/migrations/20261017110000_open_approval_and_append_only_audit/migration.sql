CREATE UNIQUE INDEX "Approval_one_open_per_ref"
ON "Approval" ("workspaceId", "kind", "refId")
WHERE "status" IN ('Pending', 'Submitted');

CREATE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW
EXECUTE FUNCTION reject_audit_event_mutation();
