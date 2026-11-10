---
tipo: security
titulo_en: Capture worker and local STT images without known HIGH vulnerabilities
titulo_pt_br: Imagens do worker de captura e do STT local sem vulnerabilidades HIGH conhecidas
---

The Go builder of `capture-worker` (Smokescreen egress proxy) and `stt-local`
moves from Go 1.25.14 to 1.27.3, and Smokescreen's `golang.org/x/net`,
`golang.org/x/text` and `logrus` are raised to fixed versions. Trivy reports no
CRITICAL or HIGH findings with a fix available in either image.

<!-- pt-BR -->

O builder Go do `capture-worker` (proxy de saída Smokescreen) e do `stt-local`
passa do Go 1.25.14 para o 1.27.3, e as dependências `golang.org/x/net`,
`golang.org/x/text` e `logrus` do Smokescreen sobem para versões corrigidas. O
Trivy não aponta nenhum achado CRITICAL ou HIGH com correção disponível nas
duas imagens.
