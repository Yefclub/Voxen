---
tipo: fix
titulo_en: Connecting an MCP client no longer detours through the library
titulo_pt_br: Conectar um cliente MCP não passa mais pela biblioteca
---

After signing in to authorize an MCP client, Voxen now goes straight to the
consent screen. Before, the app showed the library for a moment, and the
"install Voxen" prompt could appear there; installing reopened Voxen on the
library and the authorization was lost. The install prompt is no longer offered
on sign-in, sign-up, pending-approval and OAuth screens, or in windows opened by
another app.

<!-- pt-BR -->

Depois de entrar para autorizar um cliente MCP, a Voxen agora vai direto para a
tela de consentimento. Antes, o app mostrava a biblioteca por um instante e o
convite "instalar a Voxen" podia aparecer ali; ao instalar, a Voxen reabria na
biblioteca e a autorização se perdia. O convite de instalação não aparece mais
nas telas de login, cadastro, aprovação pendente e OAuth, nem em janelas abertas
por outro app.
