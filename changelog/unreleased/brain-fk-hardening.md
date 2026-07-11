---
tipo: fix
titulo: Grafo mais estável e limpar pastas sem erro 502
---

O reindex do Brain deixa de quebrar com erros de chave estrangeira sob carga
(reconciliação em paralelo). Apagar todas as pastas responde na hora — a limpeza
do grafo roda em background, sem estourar o proxy.
