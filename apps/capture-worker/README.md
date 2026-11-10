# Voxen capture worker

Container that downloads and extracts source content for link capture
(spec 220). It turns a URL or an uploaded file into text, caption segments,
metadata, images and, on request, speech-ready audio chunks. It runs no AI:
interpretation, speech-to-text and provider keys stay in the `web` process.

## Endpoints

All endpoints except `GET /health` require
`Authorization: Bearer $CAPTURE_WORKER_TOKEN`. Bodies are JSON (16 KiB max)
except `/v1/file` (multipart, 500 MB max, streamed to tmpfs).

| Method and path    | Purpose                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`      | `{ok, ytDlp}`; 503 when the egress proxy is down.                                                                                                                                                      |
| `POST /v1/extract` | `{url}` → text-first extraction (captions, post text, page text, description), metadata, `hasAudio`, `hasVideo`, up to 4 JPEG images and up to 50 top-level `comments`. Never downloads media streams. |
| `POST /v1/audio`   | `{url, format?}` → best audio only as speech-ready chunks: `{durationSec, chunks:[{startSec, mime, dataBase64}]}`. See "Audio formats".                                                                |
| `POST /v1/frames`  | `{url}` → up to 4 JPEG keyframes from a small video stream: `{durationSec, images:[{kind:"frame", mime, dataBase64, width, height, timeSec}]}`. See "Keyframes".                                       |
| `POST /v1/file`    | Multipart `file`, `filename`, `contentType`, optional `format` → audio/video (audio chunks plus 4 keyframes with `timeSec`, `hasVideo`), image (JPEG), PDF (pypdf text) or text/Markdown.              |

### Audio formats

`format` is optional on `/v1/audio` and `/v1/file`:

- `mp3` (default): mono 16 kHz MP3 at 32 kbps, chunks of at most 20 minutes,
  audio up to 3 h.
- `wav`: 16 kHz mono PCM s16le WAV (for the `stt-local` sidecar, which
  decodes WAV only), chunks of at most 8 minutes. Only for audio of **known
  duration up to 1 h**; longer or unknown-duration audio is answered with MP3
  chunks instead (the chunk `mime` says which format came back).

Any other value returns `UNSUPPORTED`.

### Comments

`comments` is `[{author, text, likes, publishedAt}]`: top-level comments only,
at most 50, sorted by likes desc, then `publishedAt` desc, then id, with
unknown values last; text is trimmed to 1,000 characters and empty or deleted
comments are dropped. Fetching has its own 60-second budget, runs alongside
captions and thumbnails, and any failure is logged and returns `[]`; it never
fails the capture.

- **YouTube**: a second, bounded yt-dlp call with `--skip-download
  --dump-single-json --write-comments --extractor-args
  "youtube:max_comments=50,all,0,0;comment_sort=top"` (top comments, no
  replies). A separate call because a comment error inside the metadata call
  would fail the whole extraction. YouTube reports approximate like counts
  ("4.8M") and relative dates, so `likes` and `publishedAt` are approximate.
- **Instagram**: the same call without extractor args (yt-dlp has no
  `max_comments` for Instagram; the list is capped after the fetch). Usually
  empty without login.
- **TikTok**: yt-dlp's TikTok extractor does not extract comments, so the
  worker calls TikTok's public comment API
  (`/api/comment/list/?aweme_id=<id>&count=50`, no login, through the egress
  proxy).
- **X**: always `[]`. Replies need a login; syndication and fxtwitter only
  report a reply count.
- Other extractors and web pages: `[]`.

### Keyframes

`/v1/frames` downloads the smallest video stream between 240p and 480p
(`bv*[height>=240][height<=?480]/bv*[height<=?480]/b[height<=?480]/wv*/w`
with `--format-sort +size,+br`; streams that do not report a height can
still be picked), at most 300 MB, with its own 10-minute budget (time spent
waiting for the heavy-work slot does not count). Frames are evenly spaced over
the known duration, or taken at 10/35/60/85% of the video packets when the
container reports none; videos under 4 s get one frame per whole second (at
least one). Videos over 3 h and live streams are rejected (`TOO_LARGE`,
`UNSUPPORTED`). Errors use the same classifier as the other endpoints.

Routing is decided by host: YouTube, TikTok and Instagram use yt-dlp; X posts
use the public syndication endpoint with an fxtwitter fallback; unknown hosts
use yt-dlp only when a non-generic extractor claims the URL, otherwise
Trafilatura (or pypdf for PDF responses).

Failures return `{error:{code, message, retryable}}` with HTTP 422
(permanent), 503 (retryable), 413 (`TOO_LARGE`) or 400 (`INVALID_URL`).
Codes: `LOGIN_REQUIRED`, `IP_BLOCKED`, `RATE_LIMITED`, `REMOVED`,
`UNSUPPORTED`, `NO_TEXT`, `TOO_LARGE`, `TIMEOUT`, `BLOCKED_ADDRESS`,
`INVALID_URL`, `UNKNOWN`. Messages are fixed per code and never echo upstream
output.

## Security model

- **Secrets.** The only secret is `CAPTURE_WORKER_TOKEN` (at least 32 chars;
  the process refuses to start otherwise). No `MASTER_KEY`, provider keys or
  database credentials. Child processes get a minimal environment without it.
- **Egress.** Stripe Smokescreen runs inside the container on
  `127.0.0.1:4750` as a supervised child; if it exits, the worker exits.
  Every outbound request (yt-dlp `--proxy`, curl_cffi, thumbnails, captions,
  X) goes through it. It resolves DNS itself and denies private, loopback,
  link-local, CGNAT, multicast and metadata ranges, and allows only ports 80
  and 443. Redirects are followed one hop at a time through the proxy. A
  denial maps to `BLOCKED_ADDRESS`.
- **yt-dlp.** Subprocess with `--ignore-config --no-plugin-dirs
  --no-remote-components`, `--use-extractors default,-generic`, the native
  downloader and `--` before the URL. No `--exec`, `--netrc-cmd`, cookies or
  external downloaders. Deno solves YouTube JS challenges with the pinned
  `yt-dlp-ejs` scripts.
- **ffmpeg.** Only ever reads local files, with `-protocol_whitelist file`.
- **Image.** No setuid or setgid binaries (stripped and verified at build
  time), so platforms that cannot drop capabilities or set
  `no-new-privileges` (Easypanel, Openship) still have no in-container
  escalation path.
- **Container.** Non-root uid 10001, read-only root filesystem, 1 GiB tmpfs
  `/tmp`, all capabilities dropped, `no-new-privileges`, 2 GiB memory, 2 CPUs,
  PID limit, no published ports. Audio, frames and upload work is serialized.

Known limitation: the proxy is enforced by configuration, not by the network.
A component that ignored the proxy settings could still open direct
connections from the container. Every component used here is configured to
use the proxy or makes no network calls; moving the proxy to a sidecar on an
`internal` network would close this gap.

## Third-party binaries and licenses

Pinned in the `Dockerfile` by exact version and checksum:

- **FFmpeg / ffprobe**: BtbN `linux64-lgpl` static build, **LGPL**, used
  unmodified and only as separate executables (ADR-014). Its license is
  shipped at `/usr/share/licenses/ffmpeg/LICENSE.txt`. BtbN prunes old
  autobuilds, so update `FFMPEG_URL` and `FFMPEG_SHA256` together when the
  build fails to download.
- **Deno** (MIT), **Smokescreen** (MIT, built from a pinned tag and commit
  with our `egress/main.go` adding the port policy), **yt-dlp** (Unlicense).

Python dependencies are pinned in `uv.lock` (hashes included). Three
unmodified MPL dependencies are documented exceptions (ADR-014): `certifi`
(Mozilla CA bundle), `tld` (used under MPL-1.1, via trafilatura → courlan)
and `golang-lru` (compiled into Smokescreen). Never install
yt-dlp's `default` extra (it pulls GPL code) or `markitdown[all]`.

## Development

```bash
cd apps/capture-worker
uv sync                  # Python 3.13
uv run pytest            # unit tests
uv run ruff check . && uv run ruff format --check .

# Full suite, including SSRF and ffmpeg integration tests, inside the image:
docker build -f apps/capture-worker/Dockerfile --target test -t voxen-capture-worker:test .
docker run --rm --read-only --tmpfs /tmp:size=1g --cap-drop ALL voxen-capture-worker:test
```
