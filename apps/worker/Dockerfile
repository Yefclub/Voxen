FROM python:3.14-slim AS builder
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

FROM python:3.14-slim AS runtime
WORKDIR /app

# ffmpeg pra chunking + utilitários básicos
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Healthcheck do worker: processo arq vivo
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD pgrep -f arq || exit 1

CMD ["arq", "src.main.WorkerSettings"]
