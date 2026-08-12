---
tipo: chore
titulo_en: Components from shadcn-format registries can now be installed by CLI
titulo_pt_br: Componentes de registries no formato shadcn agora podem ser instalados por CLI
---

Every component under the web app's `ui` directory had been transcribed by hand,
because the project had no `components.json` and therefore no supported way to
pull one from a shadcn-format registry. Each addition meant copying from GitHub,
rewriting imports and installing dependencies manually.

The file now exists, written by hand rather than generated, so that
`shadcn init` never touches the stylesheet that defines the four theme packs. It
buys scaffolding only — file placement, alias resolution and dependency install.
Registry components still arrive in shadcn's token vocabulary and still need a
manual pass onto the project's own tokens before they are usable.

<!-- pt-BR -->

Todo componente do diretório `ui` do app web tinha sido transcrito à mão, porque
o projeto não tinha `components.json` e portanto nenhum caminho suportado para
puxar um componente de registry no formato shadcn. Cada adição significava
copiar do GitHub, reescrever imports e instalar dependências na mão.

Agora o arquivo existe, escrito à mão em vez de gerado, para que o `shadcn init`
nunca encoste no stylesheet que define os quatro packs de tema. Ele entrega só
scaffolding — colocação de arquivo, resolução de alias e instalação de
dependência. Componente de registry continua chegando no vocabulário de token do
shadcn e continua precisando de um passe manual para os tokens do projeto antes
de servir.
