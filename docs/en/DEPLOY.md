# Deployment — Voxen

This guide covers production deployment. Voxen keeps development and production close: the same Docker Compose stack is used, with production environment values and optional reverse proxy configuration.

## Recommended Deployment: Home-Lab

Voxen works best on a home-lab machine such as a mini PC, NAS, Proxmox host, or dedicated desktop at home. Residential IPs are less likely to trigger YouTube download soft-blocks than datacenter IPs. A VPS is supported, but media extraction may require routing downloads through the residential proxy agent (see the PT-BR guide section "Agente de proxy residencial" in `docs/DEPLOY.md`).

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

STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/data/storage

# Optional yt-dlp bgutil HTTP provider for PO tokens.
# Use only a provider you control. Empty = default yt-dlp mode.
YTDLP_BGUTIL_BASE_URL=
```

`MASTER_KEY` encrypts application secrets stored in the database. Generate it with:

```bash
openssl rand -base64 32
```

Back up `MASTER_KEY` together with PostgreSQL and the selected storage backend.
If it is lost, encrypted secrets stored in the database cannot be recovered.

## Storage drivers and upgrade safety

New single-host installations use the shared local volume at `/data/storage`.
Both `web` and `worker` mount the same `storage_data` volume and the database
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
docker compose stop web worker
docker run --rm --network voxen_voxen-net --env-file .env.s3 \
  -v voxen_storage_data:/data:ro --entrypoint sh amazon/aws-cli:2 -c '
  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" AWS_DEFAULT_REGION="$S3_REGION"
  aws --endpoint-url "$S3_ENDPOINT" s3 sync /data "s3://$S3_BUCKET"
  aws --endpoint-url "$S3_ENDPOINT" s3 sync /data "s3://$S3_BUCKET" --dryrun'
```

For S3 to the local volume, mount it read-write and reverse the final two sync
arguments. Inspect object/file counts and total bytes, keep the source backup,
then change `STORAGE_DRIVER` and start `web` and `worker`. Confirm several old
transcripts and media ranges plus `GET /health/deep` before deleting the source.
Never switch drivers while either writer is running; there is no online dual
write or automatic rollback.

`APP_BASE_URL` must match the public browser origin exactly (`https://domain`,
without a trailing slash). If Easypanel exposes both a temporary domain and a
final domain, add the extra origin to `BETTER_AUTH_TRUSTED_ORIGINS`; otherwise
Better Auth rejects signup/login requests with `Invalid origin`.

## YouTube Extraction

The worker tries YouTube transcripts/captions before downloading audio. If a
transcript is available, Voxen stores it as subtitles with no OpenRouter audio
cost. If that path fails, the normal fallback remains: `yt-dlp` subtitles,
then audio transcription, then manual upload when the platform blocks access.

On VPS/datacenter IPs, YouTube may still block automated access. The stable
free mitigation is to run extraction from a residential/home-lab network — when
the app itself runs on a VPS, the supported way is the residential proxy agent
(`ghcr.io/yefclub/voxen-proxy-agent`): a lightweight container you run on a home
IP that the worker reaches through a reverse tunnel. Generate its token in
Admin → Integrations → Proxy Agent. If you operate your own bgutil HTTP provider
for yt-dlp PO tokens, set
`YTDLP_BGUTIL_BASE_URL=http://host:4416` in the worker environment. Do not use
public providers; this is a fragile mitigation, not a download guarantee.

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
mounted at `/data/storage`. Do not deploy separate `voxen-web`, `voxen-worker`,
or `voxen-chat` services: the combined image runs the web/API, worker, and
integrated chat runtime together.

Provision PostgreSQL and Redis first, attach the persistent storage volume,
then deploy the App from a Docker image:

- `ghcr.io/yefclub/voxen:dev` for integration deployments
- `ghcr.io/yefclub/voxen:latest` for stable releases

Configure port `3000` and health check path `/health`. In the App Environment,
set `APP_BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL`,
`REDIS_URL`, `STORAGE_DRIVER=local`, and `STORAGE_LOCAL_PATH=/data/storage`.
After deployment, verify both `/health` and `/health/deep`; the deep health
check confirms PostgreSQL, Redis, and read/write access to the selected storage.

Stable release automation publishes the versioned combined image and advances
`latest` from the same `vX.Y.Z` tag. The `dev` image is published only through a
manual `Easypanel Image` workflow run, avoiding a deployment on every merge.

The GitHub/Dockerfile source mode can work for an intentional test deployment,
but build-time environment handling may expose secrets in build logs.
Image-based deployment is the recommended production path because secrets are
supplied only at runtime.

On a home lab, this single App is all the Voxen application infrastructure you
need. On a VPS/datacenter, the optional
`ghcr.io/yefclub/voxen-proxy-agent` runs separately on a residential/home-lab
host only when media platforms block the VPS IP; it routes extraction traffic
and does not replace or duplicate the Voxen App.

For SSE notifications behind Traefik/HTTP2, deploy a version with the
HTTP2-safe SSE writer. It avoids `Connection` and `Transfer-Encoding` headers
and sends short heartbeats so `/api/jobs/events/me` remains stable.

## Operations

Safe updates that preserve volumes:

```bash
make update
make build
make restart
make backup
```

`make backup` includes PostgreSQL, `MASTER_KEY`, and the active local or Compose
MinIO volume. It fails for external S3 because provider snapshots/versioning
must be configured and verified separately. `make restore-storage` requires an
explicit archive and `RESTORE_CONFIRM=restore`; stop and verify the instance
before treating a restore as complete.
For local/Compose storage, the backup pauses web and worker, resumes only the
services that were already running, and publishes final artifacts only after the
database dump, master key, and storage snapshot all succeed.

Do not run `make clean` in production unless you intentionally want to remove all volumes and data.

## Password Reset

Voxen intentionally does not include SMTP-based password reset. The deployment owner can reset a user password on the server:

```bash
make reset-password EMAIL=user@example.com PASSWORD='newStrongPassword12'
```

The script updates the password hash and revokes active sessions.
