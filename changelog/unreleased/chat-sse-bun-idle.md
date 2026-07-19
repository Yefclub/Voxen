---
tipo: fix
título: Chat não cai mais com network error ao transcrever links
---

- Mantém o stream SSE vivo durante transcrições longas (keepalive + idleTimeout do Bun).
- Desconexões de transporte recuperam o turno em andamento sem toast de network error.
- Rate limit do YouTube em legendas volta a cair no Whisper em vez de falhar o job.
- Filtra tags geradas com raciocínio do modelo (ex.: "Looking at the content").
