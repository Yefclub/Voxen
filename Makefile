.PHONY: help dev update build down restart logs ps test test-ts test-py lint lint-ts lint-py typecheck migrate seed shell-db shell-redis garage-init master-key-show reset-password backup clean

# ============================================================================
# Voxen — one-command development
# ============================================================================
# Pré-requisito único: docker + docker compose. Nada mais.
# ============================================================================

help: ## Lista alvos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## Sobe tudo localmente (postgres, redis, garage, web, chat, worker)
	docker compose up -d --build
	@echo ""
	@echo "✓ Voxen rodando em http://localhost:3000"
	@echo "  Logs: make logs"
	@echo "  Parar: make down"

update: ## Atualiza (rolling restart sem perda de dados — recomendado pra prod)
	@# Rebuild + recriação dos containers sem mexer em volumes (DB preservado).
	@# Diferente de `restart` que faz down+up — esse não para os containers
	@# antes do novo estar pronto, então não há janela de downtime perceptível.
	docker compose up -d --build --remove-orphans
	@echo ""
	@echo "✓ Voxen atualizado. Containers recriados, volumes preservados."

build: ## Rebuild de imagens sem recriar containers
	docker compose build

down: ## Para tudo (preserva volumes — dados intactos)
	docker compose down

restart: down dev ## Reinicia tudo (down + up; volumes preservados)

logs: ## Tail dos logs (Ctrl+C pra sair)
	docker compose logs -f --tail=100

ps: ## Status dos serviços
	docker compose ps

# --- Testes ---
test: test-ts test-py ## Roda todos os testes (TS + Python)

test-ts: ## Testes do apps/web (Bun)
	cd apps/web && bun test

test-py: ## Testes do chat e worker (pytest via uv)
	cd apps/chat && uv run pytest
	cd apps/worker && uv run pytest

# --- Lint / typecheck ---
lint: lint-ts lint-py ## Lint completo

lint-ts:
	cd apps/web && bun run lint

lint-py:
	cd apps/chat && uv run ruff check .
	cd apps/worker && uv run ruff check .

typecheck:
	cd apps/web && bun run typecheck
	cd apps/chat && uv run mypy src
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
garage-init: ## Reroda bootstrap do Garage (idempotente)
	docker compose exec garage /scripts/garage-init.sh

master-key-show: ## Mostra a master key (cuidado — secret)
	docker compose exec web cat /data/master.key

reset-password: ## Reseta senha via CLI: make reset-password EMAIL=x@y.com PASSWORD=novaSenha12chars
	@if [ -z "$(EMAIL)" ] || [ -z "$(PASSWORD)" ]; then \
		echo "Erro: defina EMAIL e PASSWORD."; \
		echo "Exemplo: make reset-password EMAIL=user@exemplo.com PASSWORD='novaSenhaForte123!'"; \
		exit 2; \
	fi
	@# Passa PASSWORD via env var (não arg) pra evitar exposição em ps do container
	docker compose exec -T -e VOXEN_NEW_PASSWORD="$(PASSWORD)" web \
		bun apps/web/src/scripts/reset-password.ts "$(EMAIL)"

backup: ## Backup dos volumes críticos (postgres, master_key, garage) em ./backups/
	@mkdir -p backups
	@DATE=$$(date +%Y-%m-%d_%H%M); \
	echo "→ Postgres → backups/db-$$DATE.sql.gz"; \
	docker compose exec -T postgres pg_dump -U voxen voxen | gzip > "backups/db-$$DATE.sql.gz"; \
	echo "→ Master key → backups/master-key-$$DATE.tar.gz"; \
	docker run --rm -v voxen_master_key:/data alpine tar czf - -C /data . > "backups/master-key-$$DATE.tar.gz"; \
	echo "→ Garage data → backups/garage-$$DATE.tar.gz"; \
	docker run --rm -v voxen_garage_data:/data alpine tar czf - -C /data . > "backups/garage-$$DATE.tar.gz"; \
	echo ""; \
	echo "✓ Backup completo em ./backups/ (timestamp $$DATE)"; \
	ls -lh backups/ | tail -3

clean: ## ⚠️  REMOVE VOLUMES (PERDE TODOS OS DADOS — postgres, garage, master key)
	@echo "⚠️  ATENÇÃO: vai remover postgres, garage, master_key. Dados perdidos sem backup."
	@read -p "Digite 'sim' pra confirmar: " confirm && [ "$$confirm" = "sim" ] || (echo "Cancelado." && exit 1)
	docker compose down -v
