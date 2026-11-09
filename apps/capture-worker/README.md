# Voxen capture worker

Container that downloads and extracts source content for link capture
(spec 220). It turns a URL or an uploaded file into text, caption segments,
metadata, images and, on request, speech-ready audio chunks. It runs no AI:
interpretation, speech-to-text and provider keys stay in the `web` process.

## Endpoints

All endpoints except `GET /health` require
`Authorization: Bearer $CAPTURE_WORKER_TOKEN`. Bodies are JSON (16 KiB max)
except `/v1/file` (multipart, 500 MB max, streamed to tmpfs).

| Method and path     | Purpose                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`       | `{ok, ytDlp}`; 503 when the egress proxy is down.                                                                                                                      |
| `POST /v1/extract`  | `{url}` → text-first extraction (captions, post text, page text, description), metadata and up to 4 JPEG images. Never downloads media streams.                        |
| `POST /v1/audio`    | `{url}` → best audio only, converted to mono 16 kHz MP3 at 32 kbps and split into chunks of at most 20 minutes: `{durationSec, chunks:[{startSec, mime, dataBase64}]}`. |
| `POST /v1/file`     | Multipart `file`, `filename`, `contentType` → audio/video (audio chunks plus 4 keyframes), image (JPEG), PDF (pypdf text) or text/Markdown.                             |

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
- **Container.** Non-root uid 10001, read-only root filesystem, 1 GiB tmpfs
  `/tmp`, all capabilities dropped, `no-new-privileges`, 2 GiB memory, 2 CPUs,
  PID limit, no published ports. Audio and upload work is serialized.

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
and `go-cleanhttp` (compiled into Smokescreen). Never install
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
