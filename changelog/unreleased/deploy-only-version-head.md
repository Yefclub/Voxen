---
tipo: infra
titulo: Deploy no Easypanel só no commit de versão (mensagem limpa)
---

O script de deploy manual só aceita HEAD no formato
`set version to X.Y.Z-dev.<timestamp>` — o mesmo padrão do Orbital, em que o
deploy roda depois do version-dev. Assim o log do Easypanel deixa de mostrar
o body inteiro da PR de feature e passa a mostrar só a linha de versão.
