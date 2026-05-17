# Spec 004 — Scraper de páginas web

**Status:** Draft
**Owner:** Carlos Kalyel (Yef)
**Criado:** 2026-05-17

## Contexto

Voxen hoje indexa apenas vídeos do YouTube. O posicionamento é "base de conhecimento de conteúdos" — usuários querem indexar também artigos, blogs, docs e wikis junto com os vídeos. A solução técnica é um scraper de páginas web que produza markdown limpo (sem nav/ads/footer), preservando metadata (título, autor, data, idioma), e siga **o mesmo fluxo do worker de transcrição de vídeo**: Job → processamento → Transcript persistido → FTS → resumo IA.

Biblioteca escolhida: **Trafilatura 2.x** (Python, MIT, F1=0.958 em benchmarks independentes, output markdown nativo).

## Glossário

- **Página** — recurso HTML acessível via HTTP(S) público
- **Scrape** — processo de extrair conteúdo principal (texto + metadata) de uma página
- **Transcript de tipo WEB** — registro na tabela `Transcript` com `source = 'WEB'`

## Modelo de dados

### Mudanças no schema Prisma

```prisma
enum TranscriptSource {
  YOUTUBE
  INSTAGRAM
  TIKTOK
  WEB             // novo
}

enum TranscriptionMethod {
  API             // OpenRouter audio
  SUBTITLES       // legendas oficiais
  SCRAPE          // novo — Trafilatura
}
```

Campos atuais já servem para WEB:
- `url` — URL da página
- `title` — title tag / OpenGraph
- `channel` — site name (ex: "Hacker News", "Medium")
- `author` — autor extraído
- `durationSec` — `0` para WEB (não há duração)
- `publishedAt` — data extraída do meta
- `thumbnailUrl` — OpenGraph image
- `language` — extraído do `<html lang>` ou detectado
- `model` — `null` para SCRAPE (sem custo de transcrição)
- `costUsd` — `0`
- `plainText` — markdown puro extraído pelo Trafilatura
- `summaryMd` — resumo IA gerado depois (mesmo fluxo de vídeo)

Sem migration de coluna nova — só extensão dos enums.

## Requirements (EARS)

### Worker

1. **WHEN** o user envia uma URL HTTP(S) válida via `POST /api/jobs/scrape`, **THE** sistema **SHALL** criar um Job com `type = SCRAPE_WEB` e status `QUEUED`, publicar em `jobs:new`, e retornar `{ jobId, status, sourceUrl }` com HTTP 201.

2. **IF** a URL já tem um Transcript do mesmo userId, **THEN** o sistema **SHALL** retornar HTTP 409 com `{ transcriptId }` apontando para o existente.

3. **IF** já existe Job com mesma URL e status `QUEUED` ou `RUNNING` no mesmo userId, **THEN** o sistema **SHALL** retornar HTTP 409 com `{ jobId }` apontando para o em fila.

4. **WHEN** o worker processa um Job de tipo `SCRAPE_WEB`, **THE** worker **SHALL**:
   - Baixar o HTML via `httpx` (timeout 30s, follow_redirects=true, User-Agent identificável "VoxenBot/1.0")
   - Extrair conteúdo via Trafilatura (`output_format='markdown'`, `with_metadata=True`, `include_links=True`, `include_images=False`)
   - **IF** o conteúdo extraído tiver < 200 caracteres, **THEN** marcar Job como `FAILED` com `errorMsg = "Conteúdo insuficiente — página vazia, paywall, ou JS-heavy."`
   - Persistir como `Transcript` com `source = 'WEB'`, `transcriptionMethod = 'SCRAPE'`
   - Salvar `.md` no Garage S3 com key `workspaces/{userId}/transcripts/{transcriptId}.md`
   - Publicar eventos SSE de progresso (`downloading`, `extracting`, `uploading`, `indexing`, `done`)
   - Disparar geração de `summaryMd` IA best-effort (mesmo fluxo de vídeo)

5. **IF** o download HTTP falha por timeout/erro de rede, **THEN** o worker **SHALL** retentar até 3 vezes com backoff exponencial (1s, 2s, 4s). Se todas falharem, marcar Job como `FAILED`.

6. **IF** o domínio retorna 403/429 ou bloqueia o User-Agent, **THEN** o worker **SHALL** marcar Job como `FAILED` com `errorMsg = "Site bloqueou acesso (HTTP {code}). Sites com proteção anti-bot não são suportados."` (sem retry).

7. **THE** worker **SHALL** respeitar `robots.txt` do domínio antes de buscar a página. **IF** robots.txt proíbe acesso, **THEN** o Job **SHALL** falhar com `errorMsg = "robots.txt do site proíbe scraping."` (best-effort — falha silenciosa do robots.txt = permitir).

### Agente (chat)

8. **WHEN** o user envia uma URL HTTP(S) não-YouTube no chat, **THE** agente **SHALL** chamar a tool `scrape_url` automaticamente e informar ao usuário com mensagem curta tipo "Indexando esse conteúdo, leva alguns segundos. Te aviso ao terminar.".

9. **THE** tool `scrape_url(url)` **SHALL** validar a URL (http/https, host presente), criar o Job, publicar em `jobs:new`, e retornar `{ status, job_id, message }`.

10. **IF** a URL já está indexada, **THE** tool **SHALL** retornar `{ status: 'already_indexed', transcript_id, message }` em vez de criar novo Job.

### UI

11. **THE** tela `/jobs` **SHALL** ter duas abas/inputs: "Vídeo YouTube" e "Página web". Cada uma com placeholder e exemplos próprios.

12. **THE** Biblioteca (`/transcricoes`) **SHALL** mostrar transcripts WEB com:
    - Badge "Web" em vez de "YouTube"
    - Ícone `Globe` (lucide) em vez de thumbnail no card quando não houver `thumbnailUrl`
    - Filtro de source via query string `?source=WEB` (opcional)

13. **THE** página de detalhe (`/transcricoes/:id`) **SHALL** mostrar transcripts WEB sem o componente de tooltip-por-segmento (não há timestamps). Em vez disso, renderiza o markdown completo via componente `Markdown` (mesmo do chat).

14. **THE** dashboard **SHALL** mostrar transcripts WEB na "Atividade recente" com:
    - Thumbnail OpenGraph se existir
    - Fallback: ícone Globe + cor neutra
    - Click leva ao detalhe normal

## Não-objetivos

- ❌ Crawler recursivo (seguir links, indexar site inteiro) — fora do escopo
- ❌ Suporte a JS-heavy/SPAs (Playwright headless) — fica pra spec futura quando houver caso real
- ❌ Bypass de paywall, captcha, login required — não suportado
- ❌ Indexar PDFs, imagens, vídeos hospedados (não-YouTube) — fora do escopo
- ❌ RSS/Atom feeds — fora do escopo

## Dependências novas

- `apps/worker/pyproject.toml`: `trafilatura>=2.0.0`
- Sem mudança em chat ou web (chat só publica Job, web só recebe a request)

## Casos de teste

- ✅ URL de blog post típico (Medium, Dev.to, Substack) → MD limpo, título, autor extraídos
- ✅ URL de docs (MDN, React docs) → MD com código preservado
- ✅ URL já indexada → 409 com transcriptId
- ✅ URL inválida (não-HTTP, host vazio) → 400
- ✅ URL com 404 → Job FAILED com mensagem clara
- ✅ Site com robots.txt proibindo → Job FAILED com mensagem específica
- ❌ Site JS-heavy (Twitter, Instagram web) → Job FAILED "Conteúdo insuficiente"
- ❌ Site com paywall (NYT) → Job FAILED com conteúdo curto

## Pendências

- Definir quais erros 4xx do scraper são "retry" vs "fatal" exato (atualmente: só 5xx e timeouts retentam)
- Decidir se respeitamos `noindex` meta tag (atualmente: ignoramos, é só pra search engines)
