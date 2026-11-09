---
tipo: security
titulo_en: The capture worker image no longer ships setuid binaries
titulo_pt_br: A imagem do worker de captura não traz mais binários setuid
---

The capture worker image removes every setuid and setgid bit at build time, so deployments that cannot set `no-new-privileges` or drop capabilities (such as Easypanel or Openship) still have no privilege-escalation path inside the container.

<!-- pt-BR -->

A imagem do worker de captura remove todos os bits setuid e setgid no build, então deploys que não conseguem aplicar `no-new-privileges` nem remover capabilities (como Easypanel ou Openship) continuam sem caminho de escalada de privilégio dentro do container.
