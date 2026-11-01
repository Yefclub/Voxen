---
tipo: chore
titulo: Cancel outstanding Product 2 jobs and remove dead AI library UI
---

### Removed
- Dead library AI actions (organize with AI, regenerate titles, generate tags) that called removed Product 2 routes, plus their orphan i18n copy.
- Outstanding Product 2 jobs (QUEUED/RUNNING of removed types) are terminally cancelled by forward migration; retained DELETE_KNOWLEDGE work and finished jobs are untouched.
