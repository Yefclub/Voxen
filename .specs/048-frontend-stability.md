# 048 — Estabilidade do frontend (apps/web)

## Contexto

Auditoria read-only do frontend (`apps/web`) levantou falhas de robustez que não
aparecem em uso feliz, mas degradam ou derrubam a experiência em casos de erro,
concorrência e desmontagem de componentes. Como o Voxen é um PWA self-hosted, uma
tela branca por erro de render é especialmente ruim: o usuário fica sem nenhuma
ação de recuperação.

Esta spec cobre apenas correções de **estabilidade/lógica** — sem mudanças de
layout, responsividade ou comportamento visual (isso é escopo de outra entrega).

Problemas identificados:

1. **Sem Error Boundary global.** Qualquer exceção durante o render derruba a
   árvore React inteira para tela branca, sem fallback nem ação de recarregar.
2. **`prompt-box.tsx` vaza o microfone.** Sair do chat enquanto grava deixa o
   `MediaRecorder`/stream ativo (não há cleanup no unmount). Além disso
   `recorderRef.current!.stop()` usa `!`, que pode lançar se o estado
   dessincronizar.
3. **`notas.tsx` tem autosave concorrente.** O debounce (~1500ms) e o
   `onBlur` disparam dois `PATCH` simultâneos sem cancelamento; e um `useEffect`
   re-hidrata do servidor por cima de edições não salvas (`dirty`), podendo
   descartar trabalho do usuário.
4. **`chat.tsx` aborta o stream inteiro com um SSE malformado.** O `JSON.parse`
   por bloco não tem try/catch, então um único bloco inválido cai no catch
   externo, encerrando o streaming e marcando a mensagem com erro. O
   `FloatingTranscriptChat` em `transcricoes-detalhe.tsx` já faz parse defensivo
   por bloco — é a referência.
5. **setState após unmount.** Fetches em efeitos de montagem
   (`chat.tsx /api/capabilities`, `conta.tsx`, `login.tsx`, `cadastro.tsx`,
   `admin-usuarios.tsx`) chamam `setState` na resolução da promise mesmo se o
   componente já desmontou — warning do React e potencial atualização órfã.
6. **`setTimeout` de "copiado" sem cleanup** em `markdown.tsx` e
   `transcript-viewer.tsx` pode chamar `setState` após unmount.

## Requisitos (EARS)

- **R1** — Quando qualquer componente abaixo da raiz lançar um erro durante
  render, o sistema DEVE exibir um fallback amigável (tema zinc) com um botão de
  recarregar a página, em vez de tela branca, e DEVE logar o erro no console.
- **R2** — Enquanto o `PromptBox` estiver gravando áudio e for desmontado, o
  sistema DEVE encerrar/descartar o gravador e liberar o microfone.
- **R3** — O `PromptBox` NÃO DEVE lançar exceção ao parar a gravação quando a
  referência do gravador estiver ausente; DEVE tratar o caso com segurança.
- **R4** — Quando o usuário sair do campo de uma nota (`onBlur`) com debounce de
  salvamento pendente, o sistema DEVE cancelar o timer pendente antes de salvar,
  evitando dois `PATCH` para a mesma edição.
- **R5** — Quando dois salvamentos de nota forem disparados em sequência, o
  sistema DEVE garantir que o último prevaleça de forma determinística
  (cancelando o request em voo) e não corromper o estado `dirty`.
- **R6** — Enquanto a nota estiver `dirty`, o sistema NÃO DEVE re-hidratar o
  conteúdo a partir do servidor por cima da edição não salva.
- **R7** — Quando um bloco SSE malformado chegar durante o streaming do chat, o
  sistema DEVE ignorar apenas aquele bloco (`continue`) e manter o streaming
  ativo, sem marcar a mensagem com erro.
- **R8** — Quando um componente que faz fetch na montagem desmontar antes da
  resposta, o sistema NÃO DEVE chamar `setState` com o resultado.
- **R9** — Quando o componente que mostra "copiado" desmontar antes do timeout,
  o sistema NÃO DEVE chamar `setState` após o unmount.

## Não-objetivos

- Não alterar layout, responsividade ou aparência (escopo de outra entrega).
- Não introduzir bibliotecas novas (o Error Boundary é manual — React não tem
  componente declarativo built-in; class component com `getDerivedStateFromError`
  é o padrão oficial).
- Não mudar a assinatura do helper `api`/`apiGet` compartilhado — o problema de
  setState pós-unmount é resolvido com guarda de cleanup no efeito, sem
  refatorar o cliente HTTP.

## Critérios de aceite

- `make lint`, `make typecheck`, `make test-ts` e `bun run build` (em `apps/web`)
  verdes.
- Teste unitário do `ErrorBoundary` renderiza o fallback quando um filho lança.
- Gravação no `PromptBox` é encerrada ao desmontar (verificado por revisão de
  código — APIs de mídia não são testáveis em `bun test`).
- Sem regressão no fluxo de salvamento de notas (autosave, blur, botão salvar).
- Streaming do chat sobrevive a um bloco SSE malformado.
