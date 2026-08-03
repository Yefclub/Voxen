---
tipo: fix
titulo: Novidades passa a mostrar as releases de produção
---

A preparação de uma versão estável agora grava sua nota curada no feed de
**Novidades** antes da publicação. A versão `0.13.1` também foi recuperada no
histórico, e repetir o comando de preparação não duplica a mesma release.
O processo também interrompe a publicação sem alterar versões quando o arquivo
do histórico está ausente ou inválido.
