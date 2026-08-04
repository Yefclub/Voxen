---
tipo: fix
titulo: Hardened release reliability, SSO, and database writes
---

Database defaults used by background processing are restored so direct worker
writes remain safe after migration. OIDC setup now preserves an unexpired DNS
challenge across reloads, and public sign-in initiation has bounded abuse
controls.

The focused scrollbar controls have stronger contrast, session revalidation no
longer loses its first response, and deployment guidance now points to the
correct combined Easypanel image with safer secret handling.
