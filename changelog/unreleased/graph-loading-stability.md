---
tipo: perf
titulo: Brain 3D abre com estabilidade e permanece centralizado
---

O mapa do Brain agora acompanha a indexação por um status leve, sem baixar e
reconstruir todos os nós e relações repetidamente. O trabalho é coordenado no
Redis e pode ser retomado com segurança após reinícios, enquanto falhas reais
param o ciclo e oferecem uma tentativa explícita em vez de carregar para sempre.

A distribuição 3D também passa a nascer centralizada na origem, reenquadra a
câmera quando a topologia muda e usa cores compatíveis com o renderer, reduzindo
travamentos e avisos repetidos durante a navegação.
