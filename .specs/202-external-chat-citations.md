# Spec 202 — Citações externas no chat

## Contexto

O chat usa `[[n]]` como uma marcação interna para evidências estruturadas. Hoje a
marcação é materializada apenas para transcrições verificadas. Uma resposta baseada
em pesquisa na web pode, portanto, terminar com `[[n]]` exposto e sem uma fonte
acionável, apesar de a ferramenta já devolver URL, título e trecho da fonte.

## Glossário

- **Citação interna**: evidência de uma transcrição do workspace, aberta no canvas
  de referências do Voxen.
- **Citação externa**: evidência URL devolvida por uma pesquisa web, aberta no
  navegador em nova aba.

## Requisitos

### Ubiquitous

- The system shall persist fontes internas e externas em uma representação de
  citação estruturada, com título, trecho, URL e estado de verificação adequados.
- The system shall render uma citação interna como uma ação que abre o canvas de
  referências do Voxen.
- The system shall render uma citação externa como um link seguro que abre a URL
  original em nova aba.
- The system shall never render a marcação interna `[[n]]` como texto visível ao
  usuário em uma resposta concluída.

### Event-driven

- When uma ferramenta de pesquisa web concluir com citações URL, the system shall
  associar essas fontes à mensagem final do assistente.
- When uma resposta contiver `[[n]]` e a fonte estrutural correspondente existir,
  the system shall substituir a marcação por um controle de citação acessível.

### State-driven

- While uma resposta estiver em streaming e uma citação ainda não tiver sido
  materializada, the system shall ocultar a marcação interna pendente do conteúdo
  apresentado ao usuário.

### Optional

- Where uma fonte externa não fornecer título ou trecho, the system shall usar a
  URL como rótulo de fallback sem impedir a navegação segura.

### Unwanted behavior

- If uma citação externa tiver URL ausente ou inválida, then the system shall não
  criar um link acionável nem associá-la à marcação inline.

## Critérios de Aceite

- [ ] Uma resposta de `web_search` com fonte URL persiste uma citação externa
      estruturada.
- [ ] `[[1]]` com uma fonte externa correspondente renderiza como link acessível e
      seguro em nova aba.
- [ ] `[[1]]` sem fonte correspondente não é exibido literalmente durante nem
      após o streaming.
- [ ] Citações de transcrição verificadas continuam abrindo o canvas interno.
- [ ] Testes cobrem citação externa válida, marcador pendente e regressão de
      citação interna.

## Fora de Escopo

- Alterar a estratégia de recuperação da Base de conhecimento.
- Exibir o plano ou os parâmetros completos de ferramentas do agente.
- Verificar o conteúdo remoto além da evidência entregue pela ferramenta de
  pesquisa web.

## Riscos / Decisões pendentes

- A procedência de uma fonte web é distinta da verificação determinística de uma
  transcrição; a interface deve comunicar essa diferença sem chamar a fonte
  externa de evidência interna verificada.
