# Avaliação em shadow mode do Mem0 OSS

English: [`en/MEM0-SHADOW.md`](en/MEM0-SHADOW.md)

## Status e decisão

O Mem0 é **experimental, opcional, self-hosted e desativado por padrão**. A
decisão atual é **não permitir injeção no prompt**. A Voxen pode enviar turnos de
chat concluídos para um servidor Mem0 OSS isolado e avaliar resultados de busca,
mas esses resultados nunca entram no prompt da IA interna, Brain, MCP, citações
ou base canônica de conhecimento.

Esse limite é intencional:

- A Voxen é dona dos conteúdos-fonte, notas, evidências, fatos temporais,
  preferências controladas pelo usuário e grafo consultável.
- O Mem0 produz memórias conversacionais inferidas. Elas são candidatas de
  recuperação, não fatos verificados.
- O Graph Memory da plataforma Mem0 atualmente melhora ranking por coocorrência
  de entidades sem relações tipadas. Ele não substitui o grafo temporal e
  fundamentado em evidências da Voxen.

## O que o experimento mede

O adaptador foca preferências, projetos, pessoas e terminologias recorrentes
entre sessões de chat. Ele usa os endpoints atuais do servidor OSS self-hosted:

- `POST /memories` para processar um turno user/assistant concluído;
- `POST /search` com `explain: true` apenas no avaliador;
- `DELETE /memories?user_id=...` antes de excluir uma conta Voxen.

Não há prefixo `/v1`. A autenticação usa `X-API-Key`. A Voxen deriva um sujeito
remoto opaco e estável com HMAC a partir do `userId` autenticado; chat, MCP,
metadata e casos de avaliação não conseguem substituir esse escopo.

## Execute o Mem0 separadamente

O Mem0 não faz parte da imagem Voxen nem do Compose padrão. Implante o servidor
OSS oficial em uma rede privada e conclua a configuração de autenticação. Siga o
[guia oficial do servidor REST self-hosted](https://docs.mem0.ai/open-source/features/rest-api).

Defina no serviço `web` da Voxen:

```dotenv
VOXEN_MEMORY_PROVIDER=mem0-shadow
MEM0_BASE_URL=https://mem0.interno.exemplo
MEM0_API_KEY=m0sk_substitua_por_uma_chave_admin_dedicada
MEM0_SCOPE_SECRET=substitua_por_ao_menos_32_caracteres_aleatorios
MEM0_DEPLOYMENT_VERSION=mem0-api-server@sha256:substitua_pelo_digest_fixo
MEM0_EXTRACTION_MODEL=provider/modelo-configurado-no-mem0
MEM0_RETENTION_DAYS=30
MEM0_REQUEST_TIMEOUT_MS=5000
```

HTTP simples em uma rede Docker isolada exige confirmação explícita:

```dotenv
MEM0_BASE_URL=http://mem0:8000
MEM0_ALLOW_INSECURE_HTTP=true
```

Nunca exponha esse HTTP fora da rede privada. Mantenha a autenticação ativa e
use uma API key dedicada criada por um administrador do Mem0: o endpoint OSS
atual de exclusão em lote exige que o dono autenticado tenha papel admin. Não
reutilize essa chave em navegadores ou outras aplicações.

Fixe a imagem do Mem0 por digest e registre esse digest e o modelo de extração
exato nas duas variáveis de proveniência. As memórias expiram em 30 dias por
padrão; o intervalo aceito é de 1 a 365 dias.

`MEM0_SCOPE_SECRET` define permanentemente o namespace opaco dos usuários. Na
primeira operação, a Voxen fixa sua impressão digital no PostgreSQL e passa a
recusar rotação silenciosa. Guarde o segredo em backup: para rotacioná-lo,
primeiro limpe todos os sujeitos no Mem0 com o segredo vigente e reinicie
deliberadamente o experimento.

## Avaliação ao vivo

Depois da configuração, execute:

```bash
pnpm memory:eval
```

Opcionalmente informe o custo observado no Mem0 para os modelos/embeddings:

```bash
MEM0_EVAL_COST_USD=0.012 pnpm memory:eval
```

O comando usa sujeitos opacos descartáveis, remove todos ao final, não imprime
conteúdo das conversas e produz relatório legível por máquina com:

- recall de proveniência, acurácia do conteúdo esperado, contradições e precisão;
- taxa de falsa memória e vazamento entre usuários;
- resíduos após exclusão;
- latência p50/p95;
- tokens candidatos comparados à repetição do histórico completo;
- custo informado pelo operador.

O comando falha se recall e precisão ficarem abaixo de 0,80, falsa memória
passar de 0,10, existir qualquer vazamento/resíduo ou p95 passar de 1,5 segundo.
A taxa de contradição também deve ficar em no máximo 0,05. Passar apenas torna o
experimento **elegível para revisão controlada**; não ativa injeção no prompt.

O baseline desativado mede somente a camada incremental de memória (zero tokens
e latência externa). A recuperação canônica da Voxen continua ativa nos dois
estados e precisa de avaliação separada antes de qualquer modo controlado futuro.

## Falhas, exclusão e rollback

- Escritas do chat são best-effort; indisponibilidade do Mem0 não falha a resposta.
- Turnos interrompidos, falhos ou pausados para aprovação não são gravados.
- Um mutex Redis por usuário serializa escritas shadow e exclusão de conta entre
  réplicas da aplicação. Cada escrita registra antes da rede um marcador durável no
  PostgreSQL; a exclusão fixa um fence, bloqueia novos escritores e drena todas
  as escritas confirmadas antes de apagar o sujeito remoto, mesmo se a lease Redis
  for perdida.
- Exclusão de conta é estrita: se o Mem0 habilitado não remover o sujeito remoto,
  a Voxen mantém a conta canônica para não abandonar dados pessoais derivados.
- Use `VOXEN_MEMORY_PROVIDER=disabled` (ou remova a variável) para zerar chamadas
  de rede. Isso não contorna a limpeza: uma conta que já possua sujeito remoto
  rastreado não pode ser excluída enquanto o provedor estiver desativado. Mesmo
  uma réplica desativada fixa o fence, drena escritores e só então verifica o
  marcador novamente, protegendo alterações graduais de configuração.
- Uma escrita com resposta confirmada remove seu marcador. Timeout, queda do
  processo ou qualquer resultado ambíguo mantém o marcador e o fence de exclusão
  **sem expiração automática**, pois a requisição remota ainda pode concluir tarde.
- Para reconciliar um resultado ambíguo, interrompa novas escritas da Voxen,
  confirme que não há requisições em voo no Mem0, apague o sujeito remoto com o
  segredo original e somente então remova os marcadores operacionais. Não remova
  o fence, o sujeito rastreado ou a impressão do segredo antes dessa confirmação.
- Apagar o storage do Mem0 não remove transcrições, notas, fatos Brain, histórico
  de chat ou preferências controladas pelo usuário na Voxen.

## Antes de uma futura promoção

Uma nova especificação deverá incluir inspeção, edição, esquecimento e exportação
pelo usuário; políticas de retenção e conta bloqueada; auditoria; kill switch
administrativo; e avaliação adversarial das respostas fundamentadas. Até lá,
toda memória Mem0 é não verificada e inacessível ao modelo.
