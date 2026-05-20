# 015 — Realtime de Jobs, Resumo Automático e Configuração Direta

## Contexto

Jobs podem concluir no backend enquanto a interface fica presa em um percentual
antigo quando a conexão SSE é perdida por proxy/HTTP2. A geração automática de
resumo também acontece sem estágio visível, o que torna difícil distinguir
"transcrição concluída" de "resumo em andamento/falhou". A página de
configurações ainda força navegação por botões intermediários para editar
modelos e chave.

## Regras

- A UI não deve depender exclusivamente de Redis pub/sub para reconciliar jobs
  ativos; deve existir fallback leve por polling.
- O hook SSE deve permitir reconexão automática do `EventSource` após erro
  transitório, sem fechar a conexão na primeira falha.
- O worker deve publicar o estágio `summarizing` antes de chamar o serviço de
  resumo automático.
- A tela `/setup` deve abrir diretamente em seções editáveis quando a instância
  já estiver configurada.
- Trocar chave OpenRouter deve ser um campo opcional dentro da própria página
  de configuração, não uma tela separada obrigatória.
- A análise de X deve respeitar aliases legados de modelo Grok ao decidir o tipo
  de job.
- Bloqueios YouTube em VPS não devem depender de proxies públicos automáticos;
  a orientação técnica deve priorizar PO Token provider, cookies próprios,
  clientes compatíveis e proxies residenciais/controlados pelo operador.

## Critérios de aceite

- [x] Jobs ativos em `/transcrever` e `/jobs/:id` atualizam ao menos por polling
      mesmo quando SSE não entrega eventos.
- [x] Eventos SSE de `error` não encerram permanentemente o hook no primeiro
      erro transitório.
- [x] `summarizing` aparece como "Gerando resumo" na UI.
- [x] Pipelines de vídeo, upload, imagem, documento, X e web publicam
      `summarizing` antes de `done`.
- [x] `/setup` mostra diretamente seções editáveis de OpenRouter, modelos,
      operação e extração de mídia para instâncias configuradas.
- [x] Salvar `/setup` com nova chave valida e persiste a chave, sem exigir fluxo
      separado.
- [x] Pesquisa sobre alternativas YouTube/VPS documentada na resposta final com
      fontes atuais.
