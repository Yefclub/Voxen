---
tipo: fix
titulo_en: Update notices name the release channel, and dev drift is caught early
titulo_pt_br: Avisos de atualização nomeiam o canal da release, e o atraso do dev é detectado cedo
---

The sidebar update button now states which channel the available release
belongs to ("PRODUÇÃO vX.Y.Z disponível") and keeps the installed channel
explicit in the details line, instead of showing only the version. A scheduled
guard fails when the development version is not ahead of the latest stable
version, and the automatic development version bump no longer stalls on
advisory security findings once the protected checks are green.

<!-- pt-BR -->

O botão de atualização da sidebar agora informa a qual canal a release
disponível pertence ("PRODUÇÃO vX.Y.Z disponível") e mantém o canal instalado
explícito na linha de detalhes, em vez de mostrar só a versão. Um guard
agendado falha quando a versão de desenvolvimento não está à frente da última
versão estável, e o bump automático da versão de desenvolvimento não trava mais
em achados de segurança consultivos quando os checks protegidos estão verdes.
