-- Upload de mídia local para transcrição.
ALTER TYPE "TranscriptSource" ADD VALUE IF NOT EXISTS 'UPLOAD';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'UPLOAD_AND_TRANSCRIBE';
