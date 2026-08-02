# Atualização versionada de fontes web

## Objetivo

Permitir que uma página web já indexada seja consultada novamente sem duplicar
conteúdo ou gastar processamento quando o texto não mudou. Uma alteração cria
uma nova versão rastreável e só então atualiza os índices derivados.

## Decisões

- O escopo inicial é `Transcript.source = WEB`; vídeos, uploads e análises não
  têm uma origem remota comparável com o mesmo contrato.
- O `Transcript` continua sendo a identidade estável citada pelo chat e usada
  pelas notas. `SourceContentVersion` guarda snapshots imutáveis de cada
  conteúdo aceito, incluindo checksum, metadados e a chave do Markdown.
- O checksum é SHA-256 do texto extraído normalizado. Mudanças cosméticas no
  Markdown não criam versão nem acionam IA, Brain ou embeddings.
- A página atual é atualizada *in place* quando o checksum muda. Antes disso,
  a versão anterior é preservada; a nova recebe uma chave de storage própria.
- Uma atualização com falha nunca altera o conteúdo atual. Ela registra
  `FAILED` e uma mensagem segura; a versão anterior segue disponível.
- Citações existentes para o transcript atualizado são marcadas como
  desatualizadas. Elas permanecem históricas, mas não aparecem como evidência
  verificada da versão atual.

## Requisitos EARS

1. Quando o usuário solicitar atualização de uma fonte WEB ativa, o sistema
   deve criar um job de scrape vinculado ao transcript e marcar seu estado como
   `CHECKING`.
2. Quando a coleta concluir com o mesmo checksum, o sistema deve atualizar
   somente data/metadados de coleta, marcar `CURRENT` e encerrar o job sem
   gerar versão, resumo, tags, Brain ou embedding.
3. Quando a coleta concluir com checksum diferente, o sistema deve preservar a
   versão anterior, criar uma nova versão e atualizar FTS, Brain, extração
   grounded, embeddings e o status de citações afetadas.
4. Quando a coleta ou persistência falhar, o sistema deve manter a versão
   atual, marcar `FAILED` e mostrar o erro seguro ao usuário.
5. A tela de detalhe de fonte web deve apresentar data de coleta, versão,
   estado, histórico e uma ação manual de atualização.
6. Todas as leituras e atualizações devem ser escopadas ao `userId` do
   transcript; um usuário não pode atualizar nem observar a fonte de outro.

## Fora de escopo

- Agendamento recorrente: os campos e o job vinculável formam o contrato para
  uma automação futura, mas esta entrega não cria scheduler.
- Diff visual/linha a linha e restauração de versão anterior.
