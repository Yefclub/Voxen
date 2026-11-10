# ============================================================================
# Voxen capture worker (spec 220). Build context: repository root.
#   docker compose build capture-worker
#   docker build -f apps/capture-worker/Dockerfile --target test .   # tests
#
# Holds no MASTER_KEY, no provider keys and no database access. Every
# third-party binary is pinned by exact version and verified by checksum.
# ============================================================================

ARG PYTHON_IMAGE=python:3.13.18-slim-trixie@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90

# ---- Egress proxy: Stripe Smokescreen (MIT) from a pinned tag --------------
FROM golang:1.27.3-trixie@sha256:af1bfc2614ebb1dbd31af514b78740fd678850e76498762b425ecee4c5c6ea80 AS egress
ARG SMOKESCREEN_TAG=v0.1.0
ARG SMOKESCREEN_COMMIT=609eb8931420453daf5893509be0b25b21bd9edb
WORKDIR /src
RUN git clone --depth 1 --branch "${SMOKESCREEN_TAG}" https://github.com/stripe/smokescreen.git . \
    && test "$(git rev-parse HEAD)" = "${SMOKESCREEN_COMMIT}"
# Smokescreen v0.1.0 pins dependency versions with known HIGH CVEs; raise
# only those modules (checked against the Go checksum database).
RUN go get golang.org/x/net@v0.62.0 golang.org/x/text@v0.43.0 \
        github.com/sirupsen/logrus@v1.10.2
# Our main.go only wires an allowed-ports policy into the unmodified library.
COPY apps/capture-worker/egress/main.go ./main.go
RUN CGO_ENABLED=0 GOFLAGS=-mod=readonly go build -trimpath -ldflags="-s -w" -o /out/smokescreen . \
    && /out/smokescreen --help >/dev/null

# ---- Static binaries: Deno (MIT) and FFmpeg LGPL build (BtbN) -------------
FROM ${PYTHON_IMAGE} AS tools
# Deno runs yt-dlp's YouTube JS challenge solver (yt-dlp does not support Bun).
ARG DENO_VERSION=2.9.8
ARG DENO_SHA256=e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609
# BtbN `linux64-lgpl` static build: LGPL, unmodified, used only as a separate
# subprocess (ADR-014). BtbN keeps daily builds for 14 days but the last build
# of each month for two years, so only month-end builds are pinned here; bump
# the URL and checksum together.
ARG FFMPEG_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-linux64-lgpl-8.1.tar.xz
ARG FFMPEG_SHA256=a64f3171e6ad1f7d358d28890a907ee478c331d1177ec696a93418f79ac3f1f3
ADD --checksum=sha256:${DENO_SHA256} \
    https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip /tmp/deno.zip
ADD --checksum=sha256:${FFMPEG_SHA256} ${FFMPEG_URL} /tmp/ffmpeg.tar.xz
RUN mkdir -p /out && python - <<'EOF'
import os, stat, tarfile, zipfile
with zipfile.ZipFile("/tmp/deno.zip") as z:
    z.extract("deno", "/out")
with tarfile.open("/tmp/ffmpeg.tar.xz") as t:
    for member in t.getmembers():
        name = os.path.basename(member.name)
        if member.isfile() and name in ("ffmpeg", "ffprobe") and "/bin/" in member.name:
            member.name = name
            t.extract(member, "/out", filter="data")
        elif member.isfile() and member.name.endswith(("/LICENSE.txt", "/LICENSE")):
            member.name = "FFMPEG-LICENSE.txt"
            t.extract(member, "/out", filter="data")
for name in ("deno", "ffmpeg", "ffprobe"):
    path = os.path.join("/out", name)
    os.chmod(path, 0o755)
    assert os.path.getsize(path) > 1_000_000, name
EOF

# ---- Python dependencies (uv, frozen lockfile with hashes) ----------------
FROM ${PYTHON_IMAGE} AS deps
COPY --from=ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490 \
    /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY apps/capture-worker/pyproject.toml apps/capture-worker/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM deps AS deps-dev
RUN uv sync --frozen --no-install-project

# ---- Runtime ---------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS runtime
# Refresh Debian security fixes; bump the date when a scanner reports a fix.
ARG VOXEN_APT_SECURITY_REFRESH=2026-11-09
RUN echo "Refreshing APT security packages: ${VOXEN_APT_SECURITY_REFRESH}" \
    && apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends ca-certificates \
    && python -m pip uninstall --yes pip \
    && groupadd --system --gid 10001 capture \
    && useradd --system --uid 10001 --gid capture --home-dir /nonexistent --no-create-home capture \
    && rm -rf /var/lib/apt/lists/* \
    # Platforms that cannot set no-new-privileges or drop capabilities
    # (Easypanel, Openship) still get no setuid/setgid escalation path.
    && find / -xdev -type f -perm /6000 -exec chmod a-s {} +

COPY --from=egress /out/smokescreen /usr/local/bin/smokescreen
COPY --from=tools /out/deno /out/ffmpeg /out/ffprobe /usr/local/bin/
COPY --from=tools /out/FFMPEG-LICENSE.txt /usr/share/licenses/ffmpeg/LICENSE.txt
COPY --from=deps /app/.venv /app/.venv
COPY apps/capture-worker/src /app/src
RUN python -m compileall -q /app/src

ENV PATH="/app/.venv/bin:/usr/local/bin:/usr/bin:/bin" \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    DENO_DIR=/tmp/.deno \
    DENO_NO_UPDATE_CHECK=1

# Fail the build if a required component is missing or the wrong build.
RUN deno --version >/dev/null \
    && ffmpeg -hide_banner -version | grep -q -- "--enable-libmp3lame" \
    && ! ffmpeg -hide_banner -version | grep -q -- "--enable-gpl" \
    && yt-dlp --version >/dev/null \
    && python -c "import curl_cffi, trafilatura, pypdf, yt_dlp_ejs" \
    && test -z "$(find / -xdev -type f -perm /6000 -print -quit)"

WORKDIR /app
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request as u; o=u.build_opener(u.ProxyHandler({})); assert o.open('http://127.0.0.1:8080/health', timeout=4).status == 200"]
CMD ["python", "-m", "capture_worker.main"]

# ---- Test image: runtime + dev dependencies + tests ------------------------
FROM runtime AS test
USER root
COPY --from=deps-dev /app/.venv /app/.venv
COPY apps/capture-worker/pyproject.toml /app/pyproject.toml
COPY apps/capture-worker/tests /app/tests
USER 10001:10001
CMD ["python", "-m", "pytest", "-p", "no:cacheprovider", "-m", "", "-q"]

# Default target when built without --target (Compose builds this one).
FROM runtime
