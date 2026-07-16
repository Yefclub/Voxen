---
tipo: fix
titulo: Brain 3D estável, centralizado e mais fácil de navegar
---

O Brain deixa de alternar indefinidamente entre passes de indexação incompatíveis:
o indexador rápido agora preserva a versão completa já registrada, enquanto o
passe completo também reconhece a cobertura mínima atendida. Isso evita ciclos de
**Organizando** e falhas de cobertura em conteúdos que já foram processados.
O estado completo só é registrado depois que fontes, pastas, conceitos e relações
terminam; se uma etapa falhar, a fonte continua pendente para uma nova tentativa.
Web e worker agora compartilham uma única trava distribuída por workspace: eles
não reescrevem o mesmo Brain ao mesmo tempo, e uma indisponibilidade temporária
mantém o snapshot atual em vez de iniciar trabalho concorrente. Mudanças de fonte
e nós órfãos também são detectados e reconciliados automaticamente. Um heartbeat
renova a trava durante passes longos sem adicionar uma chamada Redis a cada etapa.

No modo 3D, a maior comunidade passa a ocupar o centro real da cena e é o foco do
primeiro enquadramento. Comunidades menores ficam distribuídas ao redor do núcleo,
com controles separados para aproximar, afastar, focar o núcleo e mostrar todo o
grafo.
