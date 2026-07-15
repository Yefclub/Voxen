---
tipo: perf
titulo: Brain 3D persistente e fluido
---

O Voxen Brain volta a abrir diretamente em 3D com um layout tridimensional
determinístico, adaptativo e sem simulação contínua. O renderer permanece
montado durante interações e atualizações, evitando o acúmulo de contextos
WebGL. A rotação volta a responder diretamente ao gesto, o contexto prioriza
desempenho e o fallback 2D cobre ausência ou falha de WebGL2 sem quebrar com
tipos semânticos de nós.
