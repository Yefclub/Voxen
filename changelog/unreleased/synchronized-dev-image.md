---
tipo: fix
titulo_en: The dev container image now follows versioned code
titulo_pt_br: A imagem de desenvolvimento agora acompanha o código versionado
---

After each automatic development version pull request passes CI and merges,
Voxen now publishes the combined image and waits for the registry push to
succeed. The mutable `dev` tag, its versioned tag, and the immutable SHA tag
therefore advance together, while `latest` remains reserved for stable
releases. Intermediate feature commits still do not publish deployable images.

<!-- pt-BR -->

Depois que cada PR automático de versão de desenvolvimento passa pelo CI e é
mesclado, a Voxen agora publica a imagem combinada e aguarda o envio ao registry
terminar com sucesso. Assim, a tag mutável `dev`, sua tag versionada e a tag
imutável por SHA avançam juntas, enquanto `latest` continua reservada para
releases estáveis. Commits intermediários de funcionalidades continuam sem
publicar imagens implantáveis.
