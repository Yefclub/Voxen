# Segurança — Voxen

Voxen é self-hosted, multi-user com adoção restrita. Este documento descreve o modelo de ameaças, decisões de segurança, e onde estão os guards.

## Threat model (resumido)

| Atacante | Vetor | Mitigação |
|---|---|---|
| Externo (internet) | Brute-force login | Rate limit no `/api/auth/*` (better-auth), senhas hash via Argon2 (default better-auth) |
| Externo | SSRF via URL maliciosa nos jobs | Allowlist de hosts no worker antes de invocar yt-dlp |
| Externo | Upload de URL que causa download grande/abusivo | (futuro) limite de duração/tamanho — owner pediu "sem limite" no MVP, mas budget por user atua de freio econômico |
| Externo | Roubo de master key se acessar env/host | Master key em `MASTER_KEY`; nunca logar e manter backup fora do servidor |
| Interno (user) | Acesso a transcrição de outro user | Query-time scoping por `userId` em TODA query; rotas admin protegidas por role |
| Interno | Exfil de secrets via DB dump | Secrets em `settings.valueEnc` cifrados com master key — dump do DB sem master key não vaza |
| Interno (admin) | Abuso de privilégio | Admin é o owner (1 pessoa); ações administrativas logadas |
| Supply chain | Pacote npm/pip malicioso | Dependabot + audits (npm audit, pip-audit) + lockfile commitado |
| Supply chain | Imagem Docker maliciosa | Trivy scan no CI em cada PR |

## Princípios

### Defense in depth

Vários layers, falha de um não compromete o sistema:
1. CORS estrito (`APP_BASE_URL` apenas)
2. Auth obrigatório em toda rota (exceto `/health`, `/api/auth/*`)
3. Validação de input com Zod (TS) / Pydantic (Python) em TODOS os endpoints
4. Auth guards verificam `userId` ANTES de query no DB
5. Queries usam scoping (`where: { userId }` sempre)
6. Output sanitizado (escapar HTML no render de transcrição se necessário)

### Least privilege

- Postgres user da aplicação (`voxen`) tem permissão apenas no DB `voxen`, sem CREATEDB/SUPERUSER
- Redis password obrigatório
- Access key S3/MinIO tem permissão apenas no bucket `voxen-transcripts`

### Secrets management

- **`.env` na raiz**: APENAS infra (DB password, Redis password, MinIO/S3, Better Auth secret, App base URL, `MASTER_KEY`)
- **Master key**: `MASTER_KEY` em todos os modos documentados, com formato
  base64 de 32 bytes (`openssl rand -base64 32`)
- **Secrets de app** (OpenRouter API key, SMTP, etc.): cifrados em `settings.valueEnc` via AES-256-GCM com master key
- **NUNCA** logar secret value (logs em produção devem mascarar)
- **NUNCA** commitar `.env` (já no `.gitignore`)
- gitleaks no CI valida que secrets não vazaram

## Auth

- **better-auth** com Prisma adapter
- Email/senha apenas (sem OAuth no MVP)
- Senhas hash com **Argon2id** (padrão better-auth)
- Sessões em DB (`Session` table), cookie HTTP-only + SameSite=Lax
- Rate limit no `/api/auth/sign-in` (5 tentativas / 15 min por IP)
- Workflow de aprovação: `status: pending | approved | rejected | disabled` na User table. Status diferente de `approved` bloqueia login

## CORS

- `apps/web` aceita requests apenas de `APP_BASE_URL`
- `apps/chat` aceita requests apenas do `apps/web` (rede interna `voxen-net`); não é exposto pra fora

## CSP (Content Security Policy)

Header CSP estrito no `apps/web`:
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' https: data:;
media-src 'self' https://*.youtube.com https://www.youtube.com;
connect-src 'self';
frame-src https://www.youtube.com;
```
(ajustar conforme features — embedded video player do YouTube precisa de `frame-src`)

## SSRF prevention (worker)

`apps/worker` valida URL antes de invocar yt-dlp:

```python
ALLOWED_HOSTS = {
    "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
    "instagram.com", "www.instagram.com",
    "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
}

def validate_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    return parsed.hostname.lower() in ALLOWED_HOSTS
```

Sem allowlist, yt-dlp + ffmpeg poderiam baixar de qualquer URL — vetor SSRF clássico.

## Subprocess safety (worker)

`yt-dlp` e `ffmpeg` rodam via subprocess. Regras:
- Timeout obrigatório (yt-dlp: 30min; ffmpeg: 30min) — `subprocess.run(..., timeout=1800)`
- Argumentos sempre via lista (nunca `shell=True`)
- Diretório de download isolado por job: `/tmp/voxen-jobs/<job_id>/`
- Limpeza forçada após job (sucesso ou falha)
- Limite de RAM no container (compose `mem_limit`)

## DB

- Migrations Prisma sempre com `IF [NOT] EXISTS` em comandos manuais
- Trigger FTS:
```sql
CREATE OR REPLACE FUNCTION update_transcript_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('portuguese', coalesce(NEW.plain_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transcript_search_vector_update
BEFORE INSERT OR UPDATE OF plain_text ON "Transcript"
FOR EACH ROW EXECUTE FUNCTION update_transcript_search_vector();
```
- Backup: dump diário do Postgres + snapshot/export do bucket MinIO/S3 + backup do valor `MASTER_KEY`

## Logs

- Apps emitem JSON estruturado (structlog em Python, biome em TS — TBD)
- **NUNCA** logar: senhas, API keys, master key, body com secrets
- Em produção: log retention 30 dias
- Eventos a logar: auth (login OK/fail), aprovações de user, jobs criados/concluídos/falhados, custos por user/dia

## CI Security

Workflows em `.github/workflows/security.yml`:

| Scanner | Cobertura |
|---|---|
| **Trivy** | Filesystem + container images (CVE em deps + binários) |
| **CodeQL** | SAST TS/JS (taint analysis, common vulns) |
| **Bandit** | SAST Python (subprocess, eval, etc.) |
| **pip-audit** | CVE em deps Python |
| **bun audit** / `npm audit` | CVE em deps TS |
| **gitleaks** | Secrets em commits/PRs |
| **dependency-review** | Análise de novas deps em PRs (GitHub Action nativa) |

Roda em: PR (todos), push em `dev`/`main`, schedule semanal.

## Resposta a incidentes

1. Revogar credenciais comprometidas (rotacionar `.env` e via UI rotacionar OpenRouter key)
2. Auditar `cost_events` e `Session` por anomalias
3. `make down && make clean` + reaplicar `.env` novo (se necessário)
4. Restore de backup Postgres + MinIO/S3 + `MASTER_KEY`

## Roadmap de segurança (não MVP)

- 2FA via TOTP no better-auth
- Rotação automática da master key
- Logs centralizados (Loki, OpenSearch)
- Audit log da tabela `audit_events`
- Limite de duração de vídeo configurável (atualmente: sem limite, owner OK com isso pra MVP)
