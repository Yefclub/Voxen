# Spec 154 — Feed de releases de produção

## Contexto

A página `/novidades` lê `releases.json`, que é empacotado na imagem web. O
fluxo de desenvolvimento registra cada changeset nesse arquivo, mas a preparação
de uma release estável apenas altera as versões dos pacotes. Embora exista um
modo capaz de promover as notas de `dev` para `prod`, ele não é chamado por
nenhum passo do fluxo; por isso `main` e as imagens estáveis contêm somente o
canal de desenvolvimento.

## Glossário

- **Entrada de produção**: registro `channel: "prod"` correspondente a uma tag
  estável `vX.Y.Z`.
- **Promoção**: agregação das entradas `dev` desde a produção anterior em uma
  entrada estável, usando `changelog/RELEASE.md` como texto curado.
- **Preparação de release**: comando `pnpm release:prepare patch|minor|major`
  executado numa branch baseada em `dev` antes da PR para `main`.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall materializar a entrada de produção antes de abrir a PR de
  release, para que o mesmo commit aprovado seja empacotado e servido.
- The system shall preservar `changelog/RELEASE.md` na branch de release, pois o
  guard da PR para `main` o usa como evidência e texto revisável.
- The system shall manter as entradas de desenvolvimento e o histórico de
  produções anteriores ao adicionar uma nova produção.
- The system shall manter uma única entrada de produção por versão, mesmo se a
  preparação for repetida na mesma branch.
- The system shall rejeitar um feed ausente, malformado ou cuja raiz não seja
  uma lista antes de alterar versões ou histórico.

### Event-driven (resposta a evento)

- When `release:prepare` calcular uma nova versão estável, the system shall
  promover as notas pendentes para essa versão e regenerar `CHANGELOG.md`.
- When a promoção usar um changelog curado, the system shall expor seu título e
  corpo na entrada `prod` e manter as mudanças promovidas como metadados.

### Unwanted behavior (condições de erro)

- If a promoção não puder ser materializada, then the system shall terminar a
  preparação com erro em vez de produzir uma release sem novidades de produção.
- If não houver `changelog/RELEASE.md` válido, then the existing release guard
  shall continuar bloqueando a PR para `main`.

## Critérios de Aceite

- [x] `pnpm release:prepare patch` atualiza os dois `package.json` e cria uma
      entrada `prod` da mesma versão em `releases.json`.
- [x] A entrada usa o título e o corpo de `changelog/RELEASE.md` e agrega as
      entradas `dev` ainda não promovidas.
- [x] `changelog/RELEASE.md` continua presente depois da preparação.
- [x] Repetir a preparação da mesma versão atualiza a promoção sem duplicá-la.
- [x] JSON malformado e raiz não-array falham sem sobrescrever o feed ou alterar
      as versões dos pacotes.
- [x] `CHANGELOG.md` é regenerado com a nova produção.
- [x] Um teste de integração do comando impede regressão do contrato completo.
- [x] O histórico atual contém a produção `0.13.1`, tornando-a visível em
      `/novidades` após a próxima imagem.

## Fora de Escopo

- Alterar a apresentação visual da página `/novidades`.
- Consultar a API do GitHub em tempo de execução da aplicação.
- Criar uma nova release estável apenas para publicar esta correção.

## Riscos / Decisões pendentes

- A promoção fica deliberadamente na branch de release, não em um workflow
  posterior ao merge, para respeitar branch protection e manter o artefato
  revisável.
- `changelog/RELEASE.md` permanece versionado até ser substituído pela curadoria
  da release seguinte; removê-lo durante a preparação quebraria o guard atual.

> 2026-08-03: escopo aprovado pelo owner junto ao conjunto de correções e
> melhorias do estudo de produto.
