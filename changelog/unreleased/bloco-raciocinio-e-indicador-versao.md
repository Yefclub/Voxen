---
tipo: fix
titulo: O bloco "Pensando" para de abrir e fechar sozinho durante a resposta
---

Em turnos em que a Vox alterna entre escrever e consultar ferramentas, o bloco
**Pensando** abria e fechava a cada consulta, e o título trocava entre
"Pensando" e "Pensou por 12s · 3 ferramentas" no mesmo ritmo — empurrando a
conversa para cima e para baixo enquanto você tentava ler.

Agora o bloco abre uma vez quando o turno começa e recolhe uma vez, um instante
depois que a resposta termina; o título fica no shimmer "Pensando" durante todo
o turno e só vira o resumo no fim. E o bloco passou a ser clicável também
durante a resposta: se você abrir ou fechar na mão, ele fica exatamente como
você deixou — nada mais mexe nele sozinho, nem quando a conexão cai e volta.

Junto disso, o contador de versões `‹ 2/3 ›` das suas mensagens agora aparece e
some com o ponteiro, igual aos botões de copiar e editar da mesma linha, em vez
de ficar sempre na tela. Navegando pelo teclado, o contador continua acessível e
reaparece assim que uma das setas recebe o foco.
