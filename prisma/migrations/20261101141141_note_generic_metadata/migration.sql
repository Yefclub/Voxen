-- Generic prepared-document metadata on Note (spec 216 §2, issue #895).
-- Notes are the generic document path: unlike Transcript, they carry no
-- platform/transcription-oriented required fields, so producers no longer
-- need fabricated media values to store prepared documents. These nullable
-- columns describe the external document (provenance); curation edits keep
-- flowing through the revisioned title/content path. Forward-only, existing
-- rows keep NULL (unknown) — no backfill, no data rewrite.
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "author" TEXT;
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
