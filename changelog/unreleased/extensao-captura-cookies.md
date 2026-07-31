---
tipo: feat
titulo: Conectar contas de TikTok, Instagram e YouTube pela extensão
---

Vídeo que só baixa com login — TikTok, Instagram, YouTube com restrição de
idade — agora tem um caminho de verdade: a extensão do Voxen conecta a conta.

Nas opções da extensão apareceu a seção **Contas de plataforma**, com um
botão "Conectar" para cada uma das três. Faça login no site normalmente, no
mesmo perfil do browser, clique em Conectar e pronto: a extensão pede a
permissão daquele site na hora, pega a sessão e envia cifrada para a sua
instância. Nada de exportar `cookies.txt` na mão nem instalar extensão de
terceiro.

A permissão é pedida por site, uma de cada vez, e só no momento do clique —
a extensão não ganha acesso a nenhum outro site. O valor da sessão nunca é
exibido de volta, nem na extensão nem no Voxen.

Em **Integrações** (admin) há um painel de estado mostrando quais plataformas
estão conectadas, quando foram conectadas e quais podem já ter expirado —
sessões passam a ser sinalizadas como "possivelmente expiradas" depois de 7
dias, e basta reconectar pela extensão. O botão "Desconectar" apaga a sessão
guardada a qualquer momento.

Conectar uma plataforma não mexe nas outras: cada uma é substituída
isoladamente.
