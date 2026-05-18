-- X (Twitter) como nova fonte de transcrição. yt-dlp suporta x.com /
-- twitter.com nativamente — reusa todo o pipeline de download+whisper.
ALTER TYPE "TranscriptSource" ADD VALUE IF NOT EXISTS 'X';
