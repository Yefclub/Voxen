---
tipo: fix
titulo: Brain 3D estável, centralizado e mais fácil de navegar
---

O Brain deixa de alternar indefinidamente entre passes de indexação incompatíveis:
o indexador rápido agora preserva a versão completa já registrada, enquanto o
passe completo também reconhece a cobertura mínima atendida. Isso evita ciclos de
**Organizando** e falhas de cobertura em conteúdos que já foram processados.

No modo 3D, a maior comunidade passa a ocupar o centro real da cena e é o foco do
primeiro enquadramento. Comunidades menores ficam distribuídas ao redor do núcleo,
com controles separados para aproximar, afastar, focar o núcleo e mostrar todo o
grafo.
