---
tipo: chore
titulo: Remove proxy-agent tunnel service and admin surface
---

### Removed
- The residential proxy-agent tunnel service is gone: dedicated image, chisel server, WebSocket tunnel proxy, admin token/status UI, and request settings.
- Orphan proxy settings are cleaned by forward migration; removed admin routes fail closed with 404.
