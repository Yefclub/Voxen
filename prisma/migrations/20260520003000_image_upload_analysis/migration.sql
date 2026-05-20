-- Upload de imagens para análise visual assíncrona.
ALTER TYPE "TranscriptionMethod" ADD VALUE IF NOT EXISTS 'VISION';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'UPLOAD_AND_ANALYZE_IMAGE';
