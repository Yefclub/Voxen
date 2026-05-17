FROM python:3.13-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY apps/chat/pyproject.toml ./
COPY apps/chat/uv.lock* ./
RUN uv sync --frozen --no-install-project || uv sync --no-install-project

COPY apps/chat/src ./src
RUN uv sync --frozen --no-editable || uv sync --no-editable

FROM python:3.13-slim AS runtime
WORKDIR /app

# apt-get upgrade pega CVEs HIGH/CRITICAL em libs base (libcap2, libsystemd0,
# libudev1) que já têm fix upstream mas vêm desatualizadas na tag slim.
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:8001/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001"]
