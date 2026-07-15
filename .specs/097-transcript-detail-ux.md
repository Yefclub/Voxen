# Spec 097 — UX do detalhe de transcrição

## Contexto

A página `/transcricoes/:id` carecia de ações rápidas (copiar resumo) e de um
caminho fluido para o chat single-session. O composer do chat principal já tem
design definido; o detalhe deve reutilizar o mesmo shell visual.

## Requisitos

### Event-driven

- When o usuário clica em copiar no resumo, the system shall copiar o markdown do
  resumo para a clipboard e confirmar com toast.
- When o usuário envia texto na barra inferior do detalhe, the system shall
  navegar para o chat com `location.state.autoSend` contendo a pergunta e o
  contexto do transcript (título + id).
- When o ChatPage monta com `autoSend`, the system shall limpar o state da
  history e disparar o envio uma única vez após o snapshot carregar.

### Ubiquitous

- The system shall exibir a barra de prompt sticky no rodapé (mesmo visual do
  composer do chat: borda, textarea auto-resize, Enter envia, botão seta).
- The system shall melhorar a hierarquia visual do detalhe (tipografia, cards,
  espaçamento, padding inferior para a barra).

## Critérios de Aceite

- [ ] Botão copiar resumo + toast
- [ ] Barra sticky → chat com autoSend
- [ ] Testes de contrato (handoff + page wiring)
- [ ] Changelog unreleased

## Fora de Escopo

- Anexos / mic na barra do detalhe (só texto; o chat completo permanece no `/`)
- Chat embutido na página de detalhe (navegação para a sessão canônica)
