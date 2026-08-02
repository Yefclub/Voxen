# Artefatos de pesquisa e estudo fundamentados

## Objetivo

Gerar briefing, FAQ, guia de estudo, timeline e mapa mental a partir de fontes
explicitamente selecionadas, preservando a proveniência e tornando cada
evidência navegável.

## Decisões

- Artefato é um derivado privado do usuário, nunca entra na recuperação como
  fonte primária nem substitui transcrições/notas.
- O escopo é resolvido no servidor para uma lista de transcrições do mesmo
  usuário: IDs, pasta, tags ou consulta textual; entradas de outro workspace
  são descartadas sem revelar sua existência.
- A primeira versão usa modelos determinísticos baseados em evidências para não
  apresentar afirmações sem fonte; cada item exibido é uma transcrição literal
  e navegável, sem depender de uma chamada de IA adicional.
- Falhas de leitura de uma fonte não abortam as demais; o artefato registra as
  fontes usadas e as indisponíveis.

## Requisitos EARS

1. Quando o usuário escolher um tipo e escopo válido, o sistema deve criar um
   artefato privado com a revisão de configuração efetiva e a lista resolvida
   de fontes.
2. Quando uma fonte não puder ser lida, o sistema deve concluir com as fontes
   restantes e expor a falha parcial.
3. Cada citação exibida deve conter transcript, trecho e link navegável; texto
   sem evidência deve ser marcado explicitamente como não verificado.
4. Quando o usuário pedir um artefato por ID, o sistema deve retornar 404 para
   IDs de outro workspace e nunca compartilhá-lo implicitamente.
5. O usuário deve poder abrir o artefato e cada uma de suas evidências.

## Fora de escopo

- Compartilhamento público, colaboração entre usuários e atualização automática
  de artefatos quando as fontes mudam.
