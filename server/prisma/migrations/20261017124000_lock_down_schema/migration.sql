DO $migration$
DECLARE
  schema_name TEXT := current_schema();
  relation_name TEXT;
  role_name TEXT;
BEGIN
  IF schema_name IS NULL THEN
    RAISE EXCEPTION 'Cannot determine current schema for security migration';
  END IF;

  FOR relation_name IN
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = schema_name
      AND relation.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      schema_name,
      relation_name
    );
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I',
        schema_name,
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I',
        schema_name,
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I',
        schema_name,
        role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I',
        schema_name,
        role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I',
        schema_name,
        role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I',
        schema_name,
        role_name
      );
    END IF;
  END LOOP;
END
$migration$;
