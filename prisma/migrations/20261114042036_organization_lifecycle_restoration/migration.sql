-- Distinguish source-lifecycle archives from explicit manual archives.
CREATE OR REPLACE FUNCTION voxen_organization_source_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  source_id TEXT := OLD.id;
  old_owner TEXT := OLD."userId";
  new_owner TEXT;
  owner_id TEXT;
  source_changed BOOLEAN;
  visibility_changed BOOLEAN;
  inactive BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    new_owner := old_owner;
    source_changed := TRUE;
    visibility_changed := TRUE;
    inactive := TRUE;
  ELSE
    new_owner := NEW."userId";
    visibility_changed := OLD.status IS DISTINCT FROM NEW.status;
    inactive := NEW.status <> 'ACTIVE';
    source_changed := OLD."userId" IS DISTINCT FROM NEW."userId"
      OR OLD.title IS DISTINCT FROM NEW.title
      OR OLD."mdPath" IS DISTINCT FROM NEW."mdPath"
      OR OLD."plainText" IS DISTINCT FROM NEW."plainText"
      OR OLD."sourceVersion" IS DISTINCT FROM NEW."sourceVersion"
      OR OLD."sourceChecksum" IS DISTINCT FROM NEW."sourceChecksum"
      OR OLD."sourceMetadata" IS DISTINCT FROM NEW."sourceMetadata"
      OR OLD."sourceCollectedAt" IS DISTINCT FROM NEW."sourceCollectedAt"
      OR OLD."correctionRevision" IS DISTINCT FROM NEW."correctionRevision"
      OR OLD."correctionState" IS DISTINCT FROM NEW."correctionState"
      OR OLD."correctedChecksum" IS DISTINCT FROM NEW."correctedChecksum"
      OR OLD."correctedMarkdown" IS DISTINCT FROM NEW."correctedMarkdown";
  END IF;
  IF NOT source_changed AND NOT visibility_changed THEN RETURN NEW; END IF;

  -- Keep source -> run -> projection lock order consistent with publication.
  IF source_changed OR inactive THEN
    PERFORM voxen_cancel_organization_runs(
      ARRAY[old_owner, new_owner], source_id,
      CASE WHEN source_changed THEN 'SOURCE_CHANGED' ELSE 'PARENT_INACTIVE' END
    );
  END IF;
  FOR owner_id IN SELECT DISTINCT unnest(ARRAY[old_owner, new_owner]) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtext('voxen:organization:projection:' || owner_id));
  END LOOP;

  IF source_changed THEN
    UPDATE "BrainSource" evidence
    SET "invalidatedAt" = CURRENT_TIMESTAMP
    FROM "BrainEdge" edge
    WHERE evidence."userId" = ANY(ARRAY[old_owner, new_owner])
      AND evidence."sourceType" = 'TRANSCRIPT'
      AND evidence."sourceId" = source_id
      AND evidence."invalidatedAt" IS NULL
      AND edge.id = evidence."edgeId" AND edge."userId" = evidence."userId"
      AND edge.method = 'llm-grounded-organization';
  END IF;

  WITH desired AS (
    SELECT edge.id,
      CASE WHEN EXISTS (
        SELECT 1 FROM "BrainSource" evidence JOIN "Transcript" source
          ON source.id = evidence."sourceId" AND source."userId" = evidence."userId"
        WHERE evidence."userId" = edge."userId" AND evidence."edgeId" = edge.id
          AND evidence."sourceType" = 'TRANSCRIPT' AND evidence."invalidatedAt" IS NULL
          AND source.status = 'ACTIVE'
      ) THEN 'ACTIVE'::"ContentStatus" ELSE 'ARCHIVED'::"ContentStatus" END AS status
    FROM "BrainEdge" edge
    WHERE edge."userId" = ANY(ARRAY[old_owner, new_owner])
      AND edge.method = 'llm-grounded-organization'
      AND (edge.status = 'ACTIVE' OR (edge.status = 'ARCHIVED' AND edge.metadata->>'organizationLifecycleArchived' = 'true'))
      AND EXISTS (
        SELECT 1 FROM "BrainSource" evidence
        WHERE evidence."userId" = edge."userId" AND evidence."edgeId" = edge.id
          AND evidence."sourceType" = 'TRANSCRIPT' AND evidence."sourceId" = source_id
      )
  )
  UPDATE "BrainEdge" edge SET status = desired.status, "updatedAt" = CURRENT_TIMESTAMP,
    metadata = CASE WHEN desired.status = 'ARCHIVED'
      THEN edge.metadata || '{"organizationLifecycleArchived":true}'::jsonb
      ELSE edge.metadata - 'organizationLifecycleArchived' END
  FROM desired WHERE edge.id = desired.id AND edge.status IS DISTINCT FROM desired.status;

  WITH desired AS (
    SELECT node.id,
      CASE WHEN EXISTS (
        SELECT 1 FROM "BrainEdge" edge WHERE edge."userId" = node."userId"
          AND edge.status = 'ACTIVE' AND (edge."fromNodeId" = node.id OR edge."toNodeId" = node.id)
      ) THEN 'ACTIVE'::"ContentStatus" ELSE 'ARCHIVED'::"ContentStatus" END AS status
    FROM "BrainNode" node
    WHERE node."userId" = ANY(ARRAY[old_owner, new_owner])
      AND node.metadata->>'method' = 'llm-grounded' AND node."sourceType" IS NULL
      AND (node.status = 'ACTIVE' OR (node.status = 'ARCHIVED' AND node.metadata->>'organizationLifecycleArchived' = 'true'))
      AND EXISTS (
        SELECT 1 FROM "BrainSource" evidence
        WHERE evidence."userId" = node."userId" AND evidence."nodeId" = node.id
          AND evidence."sourceType" = 'TRANSCRIPT' AND evidence."sourceId" = source_id
      )
  )
  UPDATE "BrainNode" node SET status = desired.status, "updatedAt" = CURRENT_TIMESTAMP,
    metadata = CASE WHEN desired.status = 'ARCHIVED'
      THEN node.metadata || '{"organizationLifecycleArchived":true}'::jsonb
      ELSE node.metadata - 'organizationLifecycleArchived' END
  FROM desired WHERE node.id = desired.id AND node.status IS DISTINCT FROM desired.status;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
