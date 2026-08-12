---
tipo: fix
titulo_en: Worker logs now say which failure happened instead of a generic one
titulo_pt_br: Logs do worker passam a dizer qual falha aconteceu, em vez de uma genérica
---

Fifteen internal failure codes never reached the logs. A safety filter, which
exists to keep external error messages out of log output, silently replaced any
code it did not recognise with a generic one — and its list had fallen behind
the code. Every research enrichment failure, several brain extraction and
summary failures, and media cleanup errors all surfaced as the same anonymous
entry, so an upstream provider outage looked identical to any other unexpected
error.

The list is now complete, and a test keeps it that way: adding a failure code
without registering it fails the build instead of going quiet in production.

Separately, brain extraction reported success when it had actually postponed
work. When the graph write lock was busy the run finished with a completion
entry showing zero concepts, which reads exactly like a document that genuinely
had none. It now reports incomplete, with the number of postponed segments, so
the two cases can be told apart.

<!-- pt-BR -->

Quinze códigos internos de falha nunca chegavam aos logs. Um filtro de segurança,
que existe para manter mensagens de erro externas fora do log, trocava em
silêncio qualquer código que não reconhecesse por um genérico — e a lista dele
tinha ficado para trás do código. Toda falha de enriquecimento por pesquisa,
várias de extração de conceitos e de resumo, e erros de limpeza de mídia
apareciam como a mesma entrada anônima, então indisponibilidade de um provedor
externo ficava idêntica a qualquer outro erro inesperado.

A lista está completa, e um teste mantém assim: adicionar código de falha sem
registrá-lo quebra o build em vez de emudecer em produção.

Em separado, a extração de conceitos reportava sucesso quando na verdade tinha
adiado trabalho. Com a trava de escrita do grafo ocupada, a passada terminava com
uma entrada de conclusão mostrando zero conceitos, o que se lê exatamente como um
documento que legitimamente não tinha nenhum. Agora reporta incompleta, com
quantos segmentos ficaram para depois, então dá para distinguir os dois casos.
