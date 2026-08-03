# Fontes do chat e Brain completo por padrão

## Objetivo

Dar às evidências do chat uma navegação compacta e auditável, por meio de um
resumo clicável e painel lateral de fontes, e eliminar o recorte como modo
inicial do Voxen Brain.

## Decisões

- O painel usa exclusivamente as citações estruturadas já verificadas no
  backend; não expõe cadeia de raciocínio nem inventa atividade de ferramentas.
- Cada fonte continua navegando para a transcrição e para sua linha ou
  timestamp de origem, preservando os estados de verificação e de fonte
  desatualizada.
- O Brain requisita a visão completa por padrão e não mostra o seletor nem o
  aviso de recorte. Os limites defensivos existentes do renderer/API permanecem
  para proteger instâncias com grafos excepcionalmente grandes.

## Requisitos EARS

1. Quando uma resposta possuir citações, o sistema deve exibir um resumo de
   fontes com a quantidade de evidências, em vez de expandir todos os cards no
   fluxo da conversa.
2. Quando o usuário abrir o resumo, o sistema deve mostrar um painel lateral
   acessível com título, trecho, localização, estado e link de cada fonte.
3. Quando uma fonte estiver desatualizada ou não verificada, o painel deve
   preservar esse estado visualmente e nunca rotulá-la como evidência válida.
4. Quando o usuário abrir o Brain, o sistema deve carregar a visão completa
   por padrão, sem solicitar que ele alterne de modo para remover um recorte.
5. O sistema deve continuar restringindo fontes, citações e Brain ao usuário
   autenticado do workspace atual.

## Fora de escopo

- Exibição de cadeia de raciocínio do modelo.
- Painel de fontes redimensionável ou persistido entre sessões.
- Remoção dos limites técnicos defensivos de volume do renderer.
