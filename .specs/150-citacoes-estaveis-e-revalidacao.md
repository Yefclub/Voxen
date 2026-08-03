# 150 — Citações estáveis e revalidação ao retomar páginas

## Objetivo

Eliminar o ciclo de abertura e fechamento dos previews de citações no Chat e
garantir que uma página retome o estado canônico do servidor quando o usuário
voltar para uma aba que ficou em segundo plano.

## Requisitos

- Quando o ponteiro ou o foco entrar em um marcador de citação verificada, a UI
  DEVE mostrar um preview estável sem transferir foco automaticamente.
- Quando o usuário alternar diretamente entre marcadores, cada preview DEVE
  encerrar e abrir uma única vez, sem piscar, reabrir em ciclo ou bloquear os
  demais links.
- Quando o usuário clicar no marcador, a UI DEVE preservar a navegação para a
  fonte da evidência.
- Quando uma página baseada em `useFetch` voltar a ficar visível, receber foco
  ou for restaurada pelo histórico do navegador, ela DEVE revalidar seus dados
  silenciosamente, preservando os dados atuais até a resposta nova chegar.
- Quando o Chat voltar a ficar visível, receber foco ou for restaurado, ele DEVE
  buscar o snapshot canônico mesmo que não exista turno ativo.
- Enquanto existir um turno ativo observado pelo Chat, a reconciliação periódica
  DEVE continuar funcionando sem criar polling duplicado.
- Quando dois eventos de retomada ocorrerem na mesma interação (por exemplo,
  `visibilitychange` e `focus`), a UI DEVE consolidá-los em uma única consulta
  em voo.
- Se a revalidação silenciosa falhar por indisponibilidade temporária, a UI DEVE
  manter o estado já renderizado e tentar novamente na próxima retomada.

## Fora de escopo

- Não introduzir sincronização colaborativa de texto ainda não salvo.
- Não alterar a persistência ou a verificação das citações.
- Não substituir SSE por outro transporte.

## Aceite

- Hover e foco consecutivos em vários marcadores não produzem ciclo visual, e
  clicar continua abrindo a fonte.
- Uma aba do Chat desatualizada converge para o snapshot atual ao ser retomada,
  inclusive sem turno ativo.
- Páginas que usam `useFetch` revalidam ao serem retomadas sem apagar o conteúdo
  enquanto carregam.
- Testes de regressão, lint, typecheck e build passam.
