# 085 — Deploy automático no Easypanel pós-merge

## Contexto

O deploy de produção do Voxen (Easypanel self-hosted, projeto e serviço
configuráveis — defaults de exemplo `yefclub` / `voxen-app`) era sempre manual
— o owner precisava disparar o redeploy à mão depois de cada merge em `dev`.
Isso já causou desatualização perceptível (ex.: `/novidades` aparentando não
ter changelog novo, quando na verdade a instância rodava uma imagem antiga).

Este script fecha essa lacuna: dado o SHA atual da `dev`, dispara o redeploy
via API tRPC do Easypanel se — e somente se — esse SHA ainda não foi
implantado. A decisão de QUANDO chamar o script (hook do Claude Code após
sincronizar `dev` pós-merge) é configuração local (`.claude/settings.local.json`,
gitignored), fora do escopo deste PR — aqui só entra o script em si, puro,
sem segredo embutido.

## Requisitos (EARS)

- **Ubiquitous**: o script SEMPRE deriva `userId`-equivalente (branch/SHA) do
  próprio repositório git em que está instalado (`scripts/../`), nunca de
  argumento externo não confiável.
- **Ubiquitous**: o script NUNCA lê nem grava a API key em arquivo — ela vem
  exclusivamente de `EASYPANEL_API_KEY` no ambiente do processo.
- **Event**: quando o script roda e a branch atual é `dev` e o SHA atual
  difere do último SHA registrado como implantado, o script DEVE disparar
  `POST /api/trpc/services.app.deployService` (`projectName=yefclub`,
  `serviceName=voxen-app`) contra `EASYPANEL_URL`.
- **Event**: quando a chamada retorna HTTP 200, o script DEVE registrar o SHA
  atual no arquivo de marcador (`EASYPANEL_MARKER`), evitando redeploy
  duplicado do mesmo commit em chamadas futuras.
- **Event**: quando a chamada retorna HTTP 500, o script DEVE retentar uma
  vez após 8s (falha transitória conhecida do Easypanel sob build concorrente)
  antes de desistir.
- **State**: enquanto o SHA atual já bate com o marcador, o script DEVE sair
  cedo (exit 0) sem chamar a API — idempotência.
- **State**: enquanto a branch atual não é `dev`, o script DEVE sair cedo
  (exit 0) sem chamar a API.
- **Optional**: se invocado com `--dry-run`, o script DEVE imprimir a
  decisão (dispararia ou não, e por quê) sem chamar a API nem escrever o
  marcador, mesmo sem `EASYPANEL_API_KEY` definida.
- **Unwanted behavior**: se `EASYPANEL_API_KEY` não estiver definida e um
  deploy REAL seria necessário (não dry-run, SHA novo, branch dev), o script
  DEVE falhar alto (exit 1, mensagem clara em stderr) e NÃO escrever o
  marcador — para que a próxima chamada tente de novo em vez de considerar
  esse SHA como "já implantado" silenciosamente.
- **Unwanted behavior**: em qualquer falha (rede, HTTP != 200 após retry,
  sem chave), o script NUNCA deve imprimir o valor de `EASYPANEL_API_KEY`
  em stdout/stderr.

## Critérios de aceite

- [x] `scripts/easypanel-deploy.sh` criado, executável, sem segredo embutido.
- [x] Testado manualmente (sandbox git descartável, sem tocar a Voxen real)
      cobrindo os 5 caminhos: dry-run sem chave, dry-run com chave, marcador
      já atualizado (skip), marcador desatualizado sem chave (falha limpa),
      branch não-dev (skip).
- [x] `make lint` (shfmt/shellcheck se configurados no projeto, ou format
      check equivalente) sem erros.
- [ ] Hook em `.claude/settings.local.json` + credencial em arquivo local
      fora do repo — configuração pessoal, feita separadamente após este PR
      mergear, sem passar por PR (é local/gitignored por natureza).

## Fora de escopo

- Configuração do hook do Claude Code que efetivamente CHAMA este script após
  cada merge — isso é `.claude/settings.local.json`, pessoal e gitignored,
  não faz sentido em PR.
- Rotação/gestão da API key do Easypanel.
- Deploy do `apps/chat`/`apps/worker` separadamente — `voxen-app` é a imagem
  única que já cobre web+chat+worker (`scripts/easypanel-entrypoint.sh`).
- Notificação (Slack/email) em caso de falha de deploy — nice-to-have futuro.
