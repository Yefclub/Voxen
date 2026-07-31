---
tipo: fix
titulo: Retry com impersonate=chrome do TikTok nunca era acionado
---

Corrigido bug de controle de fluxo que fazia a mitigação de retry do TikTok (forçar impersonation de browser via `curl_cffi` quando o download falha com "unable to extract universal data for rehydration") nunca ser executada — o erro já virava falha permanente antes do retry ter chance de rodar. O TikTok está passando por uma instabilidade conhecida e ainda não corrigida no `yt-dlp` upstream; esse retry agora funciona de verdade e recupera parte dos downloads que antes falhavam de cara.
