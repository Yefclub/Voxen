# 024 — Chat contextual em transcrições, notas vinculadas e tools OpenRouter

## Objetivo

Melhorar o fluxo entre conteúdo transcrito, chat e notas. A página de uma
transcrição deve abrir uma conversa já contextualizada no conteúdo, permitir
criar notas diretamente vinculadas à transcrição e manter controles globais de
UX mais limpos. A tool de pesquisa web e o toggle de raciocínio devem seguir a
API atual da OpenRouter.

## Escopo

- Página `/transcricoes/:id`
  - Botão de chat contextual.
  - Painel de notas vinculadas ao conteúdo.
  - Criação de nota vinculada à transcrição.
- Modelo `Note`
  - Metadados opcionais `sourceType` e `sourceId` para vínculo com conteúdo.
- Chat
  - Ao abrir a partir de uma transcrição, o prompt já deve conter o contexto do
    conteúdo mencionado.
  - A tool `create_note` deve aceitar vínculo opcional com transcrição validada
    por `userId`.
- Shell
  - Versão da aplicação como ícone discreto com tooltip.
  - Botão de sair visível na sidebar.
- OpenRouter
  - `web_search` deve usar server tool `openrouter:web_search`, não `:online`.
  - Toggle de raciocínio deve enviar `reasoning.enabled/effort/exclude` quando
    ativo e `effort: none` quando desativado.

## Requisitos EARS

### Chat contextual

- **Quando** o usuário estiver na página de uma transcrição, **o sistema deve**
  mostrar um botão de chat contextual no bloco de ações.
- **Quando** o usuário clicar no botão de chat contextual, **o sistema deve**
  criar ou abrir uma conversa e preencher o prompt com uma menção à transcrição.
- **Quando** a conversa contextual for enviada, **o sistema deve** enviar o
  conteúdo validado da transcrição no contexto de `library_mentions`.

### Notas vinculadas

- **Quando** o usuário criar uma nota na página de uma transcrição, **o sistema
  deve** persistir a nota com `sourceType=TRANSCRIPT` e `sourceId=<id>`.
- **Quando** o usuário abrir uma transcrição, **o sistema deve** listar notas
  vinculadas a ela e escopadas ao usuário autenticado.
- **Quando** a Vox criar uma nota via tool e informar `source_type=TRANSCRIPT`,
  **o sistema deve** validar que a transcrição pertence ao usuário antes de
  persistir o vínculo.
- **Se** o `source_id` não existir ou não pertencer ao usuário, **o sistema deve**
  rejeitar a criação da nota.

### Shell

- **Quando** o usuário visualizar páginas normais do app, **o sistema deve**
  mostrar apenas um ícone discreto de versão.
- **Quando** o usuário passar o mouse/focar no ícone de versão, **o sistema deve**
  mostrar tooltip com versão, SHA curto e data de build.
- **Quando** a sidebar estiver aberta, **o sistema deve** mostrar um comando de
  sair acessível, com ícone.

### Pesquisa web

- **Quando** a tool `web_search` for chamada, **o sistema deve** usar a server
  tool `openrouter:web_search` da OpenRouter.
- **Quando** a pesquisa web concluir, **o sistema deve** retornar texto com
  fontes/citações quando o modelo fornecer.
- **Se** a OpenRouter retornar erro, **o sistema deve** devolver erro claro ao
  agente sem vazar payload sensível.

### Raciocínio

- **Quando** o toggle de raciocínio estiver ativado, **o sistema deve** enviar
  `reasoning` com esforço configurado e `exclude=false`.
- **Quando** o toggle estiver desativado, **o sistema deve** enviar
  `reasoning.effort=none` para evitar raciocínio extra quando suportado.
- **Quando** a OpenRouter devolver tokens de raciocínio, **o sistema deve**
  continuar exibindo o bloco de raciocínio separado da resposta final.

## Fora de escopo

- Reescrever o chat como painel embutido na página de transcrição.
- Criar sistema completo de backlinks entre notas e todos os tipos de conteúdo.
- Migrar para Responses API.
