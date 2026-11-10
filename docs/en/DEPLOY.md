# Deployment — Voxen

This guide covers production deployment. Voxen keeps development and production close: the same Docker Compose stack is used, with production environment values and optional reverse proxy configuration.

## Recommended Deployment: Home-Lab

Voxen works best on a home-lab machine such as a mini PC, NAS, Proxmox host, or dedicated desktop at home. Residential IPs are less likely to trigger YouTube download soft-blocks than datacenter IPs. A VPS is supported for serving the knowledge base.

## Common Requirements

- A Linux host with Docker Engine 24+ and Docker Compose v2
- 2 GB RAM minimum, 4 GB recommended
- 20 GB disk minimum for the database, persistent storage, and images
- A domain if exposing the service publicly
- A complete `.env` based on `.env.example`

Install Docker on Debian or Ubuntu:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in before running Docker without `sudo`.

## Environment

Copy `.env.example` to `.env` and rotate every secret before first boot.

```env
APP_BASE_URL=https://voxen.example.com
# Optional extra Better Auth origins, comma-separated.
BETTER_AUTH_TRUSTED_ORIGINS=
NODE_ENV=production

POSTGRES_PASSWORD=...
REDIS_PASSWORD=...
BETTER_AUTH_SECRET=...
MASTER_KEY=...
# Link capture (optional): shared by web and capture-worker only.
CAPTURE_WORKER_TOKEN=...
CAPTURE_WORKER_URL=http://capture-worker:8080

STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/data/storage

```

`MASTER_KEY` encrypts application secrets stored in the database. Generate it with:

```bash
openssl rand -base64 32
```

Back up `MASTER_KEY` together with PostgreSQL and the selected storage backend.
If it is lost, encrypted secrets stored in the database cannot be recovered.

## Storage drivers and upgrade safety

New single-host installations use the shared local volume at `/data/storage`.
Both the single `web` service and the database backup mount the same `storage_data` volume and the database
continues to store provider-neutral keys, never host paths. This is the simplest
and recommended home-lab, VPS, Compose, and Easypanel topology.
Production entrypoints refuse to start local mode when this path is still on the
container's ephemeral filesystem or points inside `/app`. Attach the persistent
volume before the first start; a merely writable directory is not accepted as
durable storage.

S3 remains supported for external object storage or multi-host deployments.
Copy the values from [`.env.s3.example`](../../.env.s3.example), set
`STORAGE_DRIVER=s3`, and run `make dev-s3` when using the optional Compose
MinIO profile. A legacy installation with non-empty `S3_*` or `GARAGE_*`
values and no driver is inferred as S3 and emits a migration warning; partial
S3 configuration fails instead of falling back to an empty local volume.

Switching drivers does not migrate existing files. Copy and verify the storage
keys offline before changing `STORAGE_DRIVER`. Local storage is single-host;
use S3 for multiple application hosts or replicas.

### Offline local/S3 migration

Create and verify PostgreSQL, storage, and `MASTER_KEY` backups first. Keep the
current driver configured, stop both writers, and prepare an `.env.s3` file
containing the destination/source S3 values. For local to S3:

```bash
docker compose stop web
docker run --rm --network voxen_voxen-net --env-file .env.s3 \
  -v voxen_storage_data:/data:ro --entrypoint sh amazon/aws-cli:2 -c '
  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" AWS_DEFAULT_REGION="$S3_REGION"
  aws --endpoint-url "$S3_ENDPOINT" s3 sync /data "s3://$S3_BUCKET"
  aws --endpoint-url "$S3_ENDPOINT" s3 sync /data "s3://$S3_BUCKET" --dryrun'
```

For S3 to the local volume, mount it read-write and reverse the final two sync
arguments. Inspect object/file counts and total bytes, keep the source backup,
then change `STORAGE_DRIVER` and start `web`. Confirm several old
transcripts and media ranges plus `GET /health/deep` before deleting the source.
Never switch drivers while either writer is running; there is no online dual
write or automatic rollback.

`APP_BASE_URL` must match the public browser origin exactly (`https://domain`,
without a trailing slash). If Easypanel exposes both a temporary domain and a
final domain, add the extra origin to `BETTER_AUTH_TRUSTED_ORIGINS`; otherwise
Better Auth rejects signup/login requests with `Invalid origin`.

## Link capture (`capture-worker`)

Link and file capture (spec 220) needs a second service, `capture-worker`,
built from `apps/capture-worker/Dockerfile`. Compose already defines it on the
internal network with no published ports, a read-only root filesystem, all
capabilities dropped, `no-new-privileges`, and CPU/memory limits. It runs
yt-dlp, Deno, ffmpeg/ffprobe, Trafilatura, and the Smokescreen egress proxy.

- Generate `CAPTURE_WORKER_TOKEN` with `openssl rand -hex 32` (`make dev`
  does it for you; placeholders are rejected at startup) and give it to `web` and `capture-worker` only. The worker
  never receives `MASTER_KEY`, provider keys, or database credentials.
- `web` reaches the worker at `CAPTURE_WORKER_URL`
  (`http://capture-worker:8080` in Compose).
- Without the worker, the knowledge base, search, MCP, notes, and
  prepared-content ingestion keep working; captures end with
  `WORKER_UNAVAILABLE` after their retries.
- AI interpretation and speech-to-text use the key each user adds under
  **Account → AI providers** (`/conta/ia`): OpenAI, Anthropic, OpenRouter, xAI,
  or Google Gemini. Nothing provider-related goes into `.env`.
- The worker image ships an unmodified LGPL ffmpeg/ffprobe build (BtbN
  `linux64-lgpl`) used only as a separate binary; it is never linked into
  Voxen code. Every other dependency is MIT, Apache-2.0, BSD, ISC, or
  Unlicense (yt-dlp), except three unmodified MPL transitive dependencies
  confined to the worker (`certifi`, `tld`, `golang-lru`). See ADR-014 in
  [`DECISIONS.md`](DECISIONS.md).
- No cookies or logged-in capture are used. A home-lab residential IP is less
  likely to be blocked by media platforms than a datacenter IP; when a platform
  blocks the server, the capture suggests uploading the file instead.
- To share links from a phone, install the PWA from the browser menu; it
  registers as a share target and opens `/capturar` with the new capture.

## Optional local speech-to-text (`stt-local`)

Speech-to-text can run on the server's own CPU instead of a cloud provider
(spec 221). The `stt-local` service, built from `apps/stt-local/Dockerfile`,
serves NVIDIA Parakeet TDT 0.6B v3 (int8) behind an OpenAI-compatible
endpoint. It needs no key, holds no secrets, accepts WAV only and runs one
transcription at a time. Plan for about 2.5 GB of resident RAM: memory stays
near that peak after the first long request until the container restarts (on
tight hosts set `PARAKEET_CHUNK_SECONDS=40`: about 1.9 GB, roughly 40%
slower). An out-of-memory kill shows up as a retryable `local` failure, so the
STT chain moves on while the container restarts.
Details, pins and licenses (model weights CC-BY-4.0) are in
[`apps/stt-local/README.md`](../../apps/stt-local/README.md).

- Docker Compose: `docker compose --profile stt-local up -d --build stt-local`,
  set `STT_LOCAL_URL=http://stt-local:5092` in `.env` and recreate `web`
  (`docker compose up -d web`). The service publishes no ports and attaches
  only to `stt-net`, an `internal: true` network (no internet egress) that
  `web` joins and `capture-worker` does not.
- Easypanel and Openship: add another service named `stt-local` from the
  GitHub source with Dockerfile path `apps/stt-local/Dockerfile` and build path
  `/`, with no domain, no public port and no environment variables. Set a 3 GB memory limit
  and 2 CPUs, then add `STT_LOCAL_URL=http://<project>_stt-local:5092` (the
  internal hostname the platform shows for that service) to the Voxen App and
  redeploy it. Residual risk on these platforms: they cannot create an
  internal-only network, so the sidecar shares the project network. Every
  service in the project, including `capture-worker` (which handles untrusted
  downloads), can reach its unauthenticated endpoint, and the sidecar itself
  has internet egress. The isolation described above is guaranteed only under
  Docker Compose. Keep it unexposed; it still runs as an unprivileged user from
  an image with no setuid/setgid binaries and no secrets.
- Leave `STT_LOCAL_URL` empty when the service is not running. Each user adds
  the keyless `local` entry to their STT chain in **Account → AI providers**;
  while the sidecar is down that entry is skipped and the chain moves on.

## Home-Lab

```bash
git clone https://github.com/Yefclub/Voxen.git ~/voxen
cd ~/voxen
cp .env.example .env
# edit .env
mv docker-compose.override.yml docker-compose.override.dev.yml
docker compose up -d --build
```

Expose the service with one of these approaches:

- Cloudflare Tunnel: simplest for home networks, no router ports required.
- DDNS plus port forwarding: point ports 80 and 443 to the host and use nginx with Let's Encrypt.

## VPS or Dedicated Server with Host nginx

```bash
git clone https://github.com/Yefclub/Voxen.git /opt/voxen
cd /opt/voxen
cp .env.example .env
# edit .env
mv docker-compose.override.yml docker-compose.override.dev.yml
docker compose up -d --build
docker compose ps
```

Then install nginx and Certbot:

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp /opt/voxen/deploy/nginx/voxen.conf.example /etc/nginx/sites-available/voxen.conf
sudo nano /etc/nginx/sites-available/voxen.conf
sudo ln -s /etc/nginx/sites-available/voxen.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d voxen.example.com
```

## Docker Compose with nginx Profile

Use this when you want nginx inside Docker instead of on the host. Generate certificates first, then run:

```bash
docker compose --profile nginx up -d --build
```

## Easypanel

Easypanel is supported. The recommended topology is **one Voxen App** from the
published combined image, PostgreSQL, Redis, and one persistent App volume
mounted at `/data/storage`. The combined image runs the web/API. Link capture
additionally needs a second App for `capture-worker`; without it, Voxen still
works and captures report `WORKER_UNAVAILABLE`.

Provision PostgreSQL and Redis first, attach the persistent storage volume,
then deploy the App from a Docker image:

- `ghcr.io/yefclub/voxen:dev` for integration deployments
- `ghcr.io/yefclub/voxen:latest` for stable releases

Configure port `3000` and health check path `/health`. In the App Environment,
set `APP_BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL`,
`REDIS_URL`, `STORAGE_DRIVER=local`, and `STORAGE_LOCAL_PATH=/data/storage`.
After deployment, verify both `/health` and `/health/deep`; the deep health
check confirms PostgreSQL, Redis, and read/write access to the selected storage.

To enable capture, add a second App named `capture-worker` from the GitHub
source with Dockerfile path `apps/capture-worker/Dockerfile` (it needs no
build-time secrets). Do not expose a domain or port for it. Set only
`CAPTURE_WORKER_TOKEN` in its Environment, then add the same
`CAPTURE_WORKER_TOKEN` and `CAPTURE_WORKER_URL=http://<project>_capture-worker:8080`
(the internal service hostname Easypanel shows for that App) to the Voxen App
and redeploy it. Set a memory limit (2 GB) on the worker App. Easypanel (like
Openship) cannot apply the Compose service's read-only filesystem, dropped
capabilities or `no-new-privileges`; there the worker still runs as an
unprivileged user from an image with no setuid/setgid binaries and holds no
secret besides its token, but full container hardening requires Docker
Compose.

Stable release automation publishes the versioned combined image and advances
`latest` from the same `vX.Y.Z` tag. On `dev`, the combined image is published
only after the automatic version pull request passes CI and merges, keeping the
mutable tag aligned with versioned code without publishing intermediate
commits. Manual `Easypanel Image` workflow runs remain available.

The GitHub/Dockerfile source mode can work for an intentional test deployment,
but build-time environment handling may expose secrets in build logs.
Image-based deployment is the recommended production path because secrets are
supplied only at runtime.

On a home lab, the Voxen App plus the optional `capture-worker` App is all the
application infrastructure you need. No separate agent image is required.

For SSE notifications behind Traefik/HTTP2, deploy a version with the
HTTP2-safe SSE writer. It avoids `Connection` and `Transfer-Encoding` headers
and sends short heartbeats so `/api/jobs/events/me` remains stable.

## Operations

### Structured logs and incident collection

The web process emits one-line JSON events with `service`, `event`,
`level`, `timestamp`, and, when applicable, `request_id`, `job_id`, and
`error_code`. Web responses also include `x-request-id`. Provider payloads,
messages, cookies, tokens, and secrets are excluded from these events.

The collector ignores legacy lines and Docker/Easypanel prefixes and supports
composable filters:

```bash
docker compose logs --since 2h web 2>&1 \
  | node scripts/collect-voxen-logs.mjs --level error

docker service logs yefclub_voxen-app --since 2h 2>&1 \
  | node scripts/collect-voxen-logs.mjs --job JOB_ID

node scripts/collect-voxen-logs.mjs --file easypanel.log \
  --error-code RESEARCH_SEARCH_USAGE_MISSING
```

Additional filters include `--service`, `--event`, `--request`, and `--since`.
The final summary reports parsed and matched events plus counts by severity and
error code.

Safe updates that preserve volumes:

```bash
make update
make build
make restart
make backup
```

`make backup` includes PostgreSQL, `MASTER_KEY`, and the active local or Compose
MinIO volume. Compose MinIO is selected from the configured endpoint and its
running container, never merely from a leftover volume. Set
`VOXEN_S3_BACKUP_MODE=compose-minio` when the internal endpoint uses an alias
other than `minio`. It fails for external S3 even if an old MinIO volume exists,
because provider snapshots/versioning must be configured and verified
separately. `make restore-storage` requires an explicit archive and
`RESTORE_CONFIRM=restore`; stop and verify the instance before treating a
restore as complete.
For local/Compose storage, the backup pauses web, resumes only the service if
services that were already running, and publishes final artifacts only after the
database dump, master key, and storage snapshot all succeed.

Do not run `make clean` in production unless you intentionally want to remove all volumes and data.

## Password Reset

Voxen intentionally does not include SMTP-based password reset. The deployment owner can reset a user password on the server:

```bash
make reset-password EMAIL=user@example.com PASSWORD='newStrongPassword12'
```

The script updates the password hash and revokes active sessions.
