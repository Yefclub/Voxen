---
tipo: ui
titulo: Grafo (/grafo) redesenhado para celular — controles, câmera 3D e visualização
---

A página do Grafo (Brain) tinha vários problemas específicos de celular, agora corrigidos:

- **Barra de controles menos poluída**: no celular, as estatísticas do grafo (transcrições,
  notas, pastas, conceitos, conexões) saem da fileira principal — que antes quebrava em
  várias linhas — e vão para um botão de informação dedicado, que abre um painel só com
  elas. Busca, alternância 2D/3D e atualizar continuam sempre visíveis, sem disputar espaço.
- **Câmera 2D por padrão no celular**: o grafo agora abre em modo 2D (arrastar move a
  câmera) em telas estreitas, em vez de 3D (arrastar gira a câmera) — girar com o dedo é um
  gesto ruim em touchscreen. No desktop o padrão continua 3D. O botão de alternar 2D/3D
  continua disponível nos dois casos.
- **Visualização sem WebGL adaptada à tela**: quando o navegador não suporta WebGL (fallback
  final, sem o grafo 3D nem o 2D acelerado), o desenho agora se ajusta à proporção real da
  tela em vez de assumir sempre paisagem — evita faixas vazias grandes em cima/embaixo em
  telas retrato (a maioria dos celulares).
- **Nós um pouco maiores em telas touch**: o alvo de toque mínimo dos nós do grafo aumenta
  em dispositivos touch, facilitando selecionar itens pequenos com o dedo.
