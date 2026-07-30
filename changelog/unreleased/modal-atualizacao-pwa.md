---
type: fix
title: Atualizações deixam de prender a interface antiga
---

O aviso de nova versão passa a usar a versão exata do pacote e prepara a
atualização do app em segundo plano. Navegações online deixam de reutilizar o
HTML antigo do PWA, evitando que uma interface desatualizada continue ativa
depois de um deploy.

O modal mantém cabeçalho e ações sempre acessíveis e concentra a rolagem em uma
única região central, inclusive quando as notas da versão são extensas.
