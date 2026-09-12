.PHONY: help ensure-env dev dev-s3 update build down restart logs ps test test-scripts test-ts test-extension test-py lint lint-ts lint-py format format-ts format-py format-check format-check-ts format-check-py typecheck migrate seed shell-db shell-redis minio-init minio-cors master-key-show reset-password backup restore-storage clean

# ============================================================================
# Voxen — one-command development
# ============================================================================
# Pré-requisito único: docker + docker compose. Nada mais.
# ============================================================================

help: ## Lista alvos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Versão e SHA detectados do git (passados como build-args via compose).
# Versão prefere a tag mais recente (`v0.1.2` → `0.1.2-dev.<n_commits>+<sha>`);
# se não houver tag, lê de package.json.
export VOXEN_GIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null)
export VOXEN_VERSION := $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//' || node -p "require('./package.json').version" 2>/dev/null)
export VOXEN_BUILT_AT := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

ensure-env: ## Cria/completa .env local sem sobrescrever secrets existentes
	@scripts/ensure-env.sh

dev: ensure-env ## Starts PostgreSQL, Redis, web, and worker with local storage
	docker compose up -d --build
	@echo ""
	@echo "✓ Voxen rodando em http://localhost:3000 (v$(VOXEN_VERSION))"
	@echo "  Logs: make logs"
	@echo "  Parar: make down"

dev-s3: ensure-env ## Starts the optional MinIO/S3 profile (requires .env S3 values)
	STORAGE_DRIVER=s3 docker compose --profile s3 up -d minio minio-init
	STORAGE_DRIVER=s3 docker compose --profile s3 up -d --build web worker
	@echo "✓ Voxen S3 profile running at http://localhost:3000"
	@echo "  MinIO Console: http://localhost:9001"

update: ensure-env ## Atualiza (rolling restart sem perda de dados — recomendado pra prod)
	@# Rebuild + recriação dos containers sem mexer em volumes (DB preservado).
	@# Diferente de `restart` que faz down+up — esse não para os containers
	@# antes do novo estar pronto, então não há janela de downtime perceptível.
	docker compose up -d --build --remove-orphans
	@echo ""
	@echo "✓ Voxen atualizado pra v$(VOXEN_VERSION). Volumes preservados."

build: ensure-env ## Rebuild de imagens sem recriar containers
	docker compose build

down: ## Para tudo (preserva volumes — dados intactos)
	docker compose down

restart: down dev ## Reinicia tudo (down + up; volumes preservados)

logs: ## Tail dos logs (Ctrl+C pra sair)
	docker compose logs -f --tail=100

ps: ## Status dos serviços
	docker compose ps

# --- Testes ---
test: test-scripts test-ts test-extension test-py ## Roda todos os testes (scripts + TS + extensão + Python)

test-scripts: ## Testes dos scripts de automação (Node.js)
	node --test scripts/*.test.mjs

test-ts: ## Testes do apps/web (Bun)
	cd apps/web && bun test

test-extension: ## Testes da extensão MV3 (Bun)
	cd apps/web && bun run test:extension

test-py: ## Testes do worker (pytest via uv)
	cd apps/worker && uv run pytest

# --- Lint / format / typecheck ---
lint: lint-ts lint-py ## Lint completo

lint-ts:
	cd apps/web && bun run lint

lint-py:
	cd apps/worker && uv run ruff check .

format: format-ts format-py ## Aplica formatacao (Prettier + Ruff)

format-ts:
	cd apps/web && bun run format

format-py:
	cd apps/worker && uv run ruff format .

format-check: format-check-ts format-check-py ## Verifica formatacao sem alterar arquivos

format-check-ts:
	cd apps/web && bun run format:check

format-check-py:
	cd apps/worker && uv run ruff format --check .

typecheck:
	cd apps/web && bun run typecheck
	cd apps/worker && uv run mypy src

# --- DB ---
migrate: ## Aplica migrations Prisma
	docker compose exec web pnpm prisma migrate deploy

seed: ## Seed de dev (cria nada em prod)
	docker compose exec web pnpm prisma db seed

shell-db: ## psql no postgres
	docker compose exec postgres psql -U voxen voxen

shell-redis: ## redis-cli
	docker compose exec redis redis-cli

# --- Infra utilidades ---
minio-init: ## Reroda criação do bucket MinIO (idempotente)
	docker compose --profile s3 up minio-init

minio-cors: ## Aplica CORS no bucket p/ upload presigned: make minio-cors APP_ORIGIN=https://app.dominio.com
	@if [ -z "$(APP_ORIGIN)" ]; then \
		echo "Erro: defina APP_ORIGIN. Ex.: make minio-cors APP_ORIGIN=https://app.seudominio.com"; \
		exit 2; \
	fi
	APP_ORIGIN="$(APP_ORIGIN)" sh scripts/minio-cors.sh

master-key-show: ## Mostra a master key (cuidado — secret)
	@grep '^MASTER_KEY=' .env | sed 's/^MASTER_KEY=//'

reset-password: ## Reseta senha via CLI: make reset-password EMAIL=x@y.com PASSWORD=novaSenha12chars
	@if [ -z "$(EMAIL)" ] || [ -z "$(PASSWORD)" ]; then \
		echo "Erro: defina EMAIL e PASSWORD."; \
		echo "Exemplo: make reset-password EMAIL=user@exemplo.com PASSWORD='novaSenhaForte123!'"; \
		exit 2; \
	fi
	@# Passa PASSWORD via env var (não arg) pra evitar exposição em ps do container
	docker compose exec -T -e VOXEN_NEW_PASSWORD="$(PASSWORD)" web \
		bun apps/web/src/scripts/reset-password.ts "$(EMAIL)"

backup: ## Backs up PostgreSQL, selected storage, and MASTER_KEY into ./backups/
	@bash scripts/backup.sh

restore-storage: ## Restores BACKUP into the selected local/MinIO volume (destructive)
	@if [ "$(RESTORE_CONFIRM)" != "restore" ] || [ -z "$(BACKUP)" ]; then \
		echo "Usage: make restore-storage BACKUP=backups/storage-YYYY-MM-DD_HHMM.tar.gz RESTORE_CONFIRM=restore"; \
		exit 2; \
	fi
	@test -f "$(BACKUP)" || (echo "Backup not found: $(BACKUP)" >&2; exit 2)
	docker compose down
	@if echo "$(notdir $(BACKUP))" | grep -q '^minio-'; then VOLUME=voxen_minio_data; else VOLUME=voxen_storage_data; fi; \
	docker run --rm -v $$VOLUME:/data -v "$(abspath $(BACKUP)):/backup.tar.gz:ro" alpine sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf /backup.tar.gz -C /data'
	@echo "Storage restored. Run make dev (or make dev-s3) and verify /health/deep."

clean: ## ⚠️  REMOVE VOLUMES (PERDE TODOS OS DADOS — postgres, redis, storage)
	@echo "⚠️  ATENÇÃO: vai remover postgres, redis e storage. Dados perdidos sem backup."
	@read -p "Digite 'sim' pra confirmar: " confirm && [ "$$confirm" = "sim" ] || (echo "Cancelado." && exit 1)
	docker compose down -v
