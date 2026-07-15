---
tipo: perf
titulo: Brain 3D persistente e fluido
---

O Voxen Brain volta a abrir diretamente em 3D com um layout tridimensional
determinístico, adaptativo e sem simulação contínua. O renderer permanece
montado durante interações e atualizações, evitando o acúmulo de contextos
WebGL, e o fallback 2D deixa de falhar com tipos semânticos de nós.
