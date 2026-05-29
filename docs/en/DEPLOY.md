# Deployment — Voxen

This guide covers production deployment. Voxen keeps development and production close: the same Docker Compose stack is used, with production environment values and optional reverse proxy configuration.

## Recommended Deployment: Home-Lab

Voxen works best on a home-lab machine such as a mini PC, NAS, Proxmox host, or dedicated desktop at home. Residential IPs are less likely to trigger YouTube download soft-blocks than datacenter IPs. A VPS is supported, but media extraction may require a residential proxy configured in the instance settings.

## Common Requirements

- A Linux host with Docker Engine 24+ and Docker Compose v2
- 2 GB RAM minimum, 4 GB recommended
- 20 GB disk minimum for database, object storage, and images
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

MINIO_ROOT_USER=voxen
MINIO_ROOT_PASSWORD=...
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=voxen
S3_SECRET_KEY=...
S3_BUCKET=voxen-transcripts
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# Optional yt-dlp bgutil HTTP provider for PO tokens.
# Use only a provider you control. Empty = default yt-dlp mode.
YTDLP_BGUTIL_BASE_URL=
```

`MASTER_KEY` encrypts application secrets stored in the database. Generate it with:

```bash
openssl rand -base64 32
```

Back up `MASTER_KEY` together with Postgres and MinIO/S3 data. If it is lost, encrypted secrets stored in the database cannot be recovered.

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
free mitigation is to run extraction from a residential/home-lab network. If
you operate your own bgutil HTTP provider for yt-dlp PO tokens, set
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

Easypanel is supported. Prefer deploying a published Docker image:

- `ghcr.io/yefclub/voxen:dev` for integration deployments
- `ghcr.io/yefclub/voxen:latest` for stable releases

The GitHub/Dockerfile source mode can work, but build-time environment handling may expose secrets in build logs. Image-based deployment is safer.

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

Do not run `make clean` in production unless you intentionally want to remove all volumes and data.

## Password Reset

Voxen intentionally does not include SMTP-based password reset. The deployment owner can reset a user password on the server:

```bash
make reset-password EMAIL=user@example.com PASSWORD='newStrongPassword12'
```

The script updates the password hash and revokes active sessions.
