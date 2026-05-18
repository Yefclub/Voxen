.PHONY: help dev down restart logs ps test test-ts test-py lint lint-ts lint-py typecheck migrate seed shell-db shell-redis garage-init master-key-show reset-password clean

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

down: ## Para tudo (preserva volumes)
	docker compose down

restart: down dev ## Reinicia tudo

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

clean: ## Remove volumes (PERDE DADOS)
	docker compose down -v
