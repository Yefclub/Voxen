---
tipo: infra
titulo: CI mais rápido e extensão sob o mesmo padrão de formatação
---

O cache de build passou a ser separado por imagem também na publicação de
release e na varredura de segurança. Antes as duas imagens dividiam o mesmo
espaço de cache: na publicação uma sobrescrevia a da outra, e a varredura lia
de um espaço que ninguém preenchia. Nos dois casos cada execução recomeçava
quase do zero.

Os arquivos da extensão do navegador passaram a seguir o mesmo padrão de
formatação do resto do projeto, agora com verificação automática. Nada muda
no que a extensão faz — é organização de código.
