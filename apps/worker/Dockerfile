FROM python:3.13-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY apps/worker/pyproject.toml ./
COPY apps/worker/uv.lock* ./
RUN uv sync --frozen --no-install-project || uv sync --no-install-project

COPY apps/worker/src ./src
RUN uv sync --frozen --no-editable || uv sync --no-editable

FROM python:3.13-slim AS runtime
WORKDIR /app

# apt-get upgrade pega CVEs HIGH/CRITICAL em libs base (libcap2, libsystemd0,
# libudev1) que já têm fix upstream mas vêm desatualizadas na tag slim.
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY apps/worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Healthcheck: ping no Redis (worker depende dele pra pub/sub de jobs).
# `pgrep` não está disponível em python:3.13-slim e instalar procps puxa CVEs.
# Usar o próprio Python (já no PATH) com a lib redis (dep do worker).
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "import os,redis; assert redis.Redis.from_url(os.environ['REDIS_URL']).ping()" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "-m", "src.main"]
