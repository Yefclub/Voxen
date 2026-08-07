---
tipo: feat
titulo_en: Voxen 0.14.3 — open-source launch readiness
titulo_pt_br: Voxen 0.14.3 — preparação para lançamento open-source
---

## Focused workspace and evidence flow

The focused interface now behaves as a true workspace: its collapsed rail is
centered, the sources surface opens as part of the background workspace, and
the conversation contracts without the floating header covering content. Shell
spacing, mobile chat clearance, and the compact scrollbar controls were refined
as well. Artifacts are deliberately paused in navigation while their next
product iteration is prepared.

## Clearer personal and administrative boundaries

Personal profile, platform-account, and MCP pages now share the same page
hierarchy as the rest of the product. Instance configuration remains visibly
separate for administrators, with OIDC SSO support and stronger controls for
accounts, roles, and user isolation.

## Library retrieval informed by the knowledge graph

Transcript search is easier to reach and can use related concepts already
grounded in the graph in addition to traditional text fields. The additional
signal has controlled weight, skips short queries, and remains limited to the
current user's knowledge base.

## Trustworthy chat and release information

Chat reasoning renders Markdown using the same sanitization as responses. The
What's New feed is now bound to the environment that is actually running:
development and production histories cannot be mixed through a URL parameter.
New entries can carry curated English and Brazilian Portuguese text, while
legacy entries continue to fall back safely.

## Easier self-hosted deployment

The Easypanel guide now documents the supported single-image topology: one
combined Voxen App runs the web/API, worker, and integrated chat runtime, while
PostgreSQL, Redis, and S3-compatible storage remain persistent services. The
residential proxy agent is explicitly optional for VPS media extraction.

<!-- pt-BR -->

## Espaço focado e fluxo de evidências

A interface focada agora se comporta como um espaço de trabalho: sua barra
recolhida fica centralizada, o painel de fontes abre como parte do plano de
fundo e a conversa se retrai sem que o cabeçalho flutuante cubra o conteúdo. O
espaçamento da estrutura, a área livre do chat no celular e os controles
compactos da barra de rolagem também foram refinados. Artefatos foram
intencionalmente pausados na navegação enquanto seu próximo ciclo de produto é
preparado.

## Limites mais claros entre conta e administração

As páginas de perfil, contas de plataforma e MCP agora compartilham a mesma
hierarquia das demais áreas do produto. A configuração da instância permanece
visivelmente separada para administradores, com suporte a SSO OIDC e controles
mais fortes de contas, papéis e isolamento de usuários.

## Recuperação da biblioteca informada pelo grafo

A busca de transcrições ficou mais fácil de alcançar e pode usar conceitos
relacionados já fundamentados no grafo, além dos campos textuais tradicionais.
O sinal adicional tem peso controlado, ignora buscas curtas e continua limitado
à base de conhecimento do usuário atual.

## Chat e informações de release confiáveis

O raciocínio do chat renderiza Markdown com a mesma sanitização das respostas.
O feed de Novidades agora está ligado ao ambiente que realmente está em
execução: históricos de desenvolvimento e produção não podem ser misturados por
um parâmetro de URL. Novas entradas podem trazer textos curados em inglês e
português do Brasil, enquanto entradas legadas continuam com fallback seguro.

## Implantação self-hosted mais simples

O guia do Easypanel agora documenta a topologia suportada de imagem única: um
App Voxen combinado executa web/API, worker e runtime de chat integrado,
enquanto PostgreSQL, Redis e armazenamento compatível com S3 continuam como
serviços persistentes. O agente de proxy residencial é explicitamente opcional
para extração de mídia em VPS.
