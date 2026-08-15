# Spec 201 — Confiabilidade e recuperação da ingestão

## Contexto

A fila de ingestão atualmente combina o resultado canônico do conteúdo, a
indexação do Brain e pesquisas complementares em um único estado terminal. Uma
contenção transitória pode deixar um job permanentemente marcado com pendência
mesmo depois da recuperação automática, enquanto falhas externas distintas são
reduzidas a uma mensagem genérica que impede diagnóstico e ação corretiva.

Esta spec define estados verificáveis e recuperáveis para ingestão, indexação e
pesquisa complementar, além de mensagens seguras e acionáveis para integrações
externas. O conteúdo já persistido não deve ser perdido nem processado novamente
quando apenas uma etapa derivada precisar de repetição.

## Glossário

- **Ingestão canônica**: obtenção e persistência do conteúdo principal utilizável.
- **Etapa derivada**: resumo, tags, indexação do Brain, compilação ou pesquisa
  complementar que pode ser refeita sem repetir a ingestão canônica.
- **Pendência ativa**: etapa derivada que ainda requer tentativa automática ou
  manual.
- **Pendência resolvida**: etapa derivada que terminou após uma falha transitória.
- **Diagnóstico seguro**: código e metadados operacionais que não incluem secrets,
  corpos não confiáveis de provedores ou conteúdo privado.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall manter separados o estado terminal da ingestão canônica, o
  estado da indexação do Brain e o estado da pesquisa complementar.
- The system shall preservar conteúdo canônico já persistido quando uma etapa
  derivada falhar ou precisar ser repetida.
- The system shall registrar para falhas externas um código estável, a etapa, a
  categoria da falha e metadados operacionais seguros suficientes para o admin
  distinguir rejeição, indisponibilidade, limite e bloqueio da fonte.
- The system shall nunca persistir ou exibir secrets, corpos brutos não confiáveis
  de provedores ou cookies em diagnósticos.
- The system shall apresentar ao usuário mensagens específicas e acionáveis para
  falhas conhecidas de X, TikTok, OpenRouter e indexação.

### Event-driven (resposta a evento)

- When a ingestão canônica e todas as etapas obrigatórias terminarem, the system
  shall marcar o job como concluído.
- When a indexação do Brain encontrar contenção transitória, the system shall
  repetir a operação com espera limitada antes de criar uma pendência ativa.
- When a recuperação automática concluir a última pendência obrigatória, the
  system shall promover o job para concluído e remover a mensagem obsoleta.
- When uma pesquisa complementar terminar ou falhar, the system shall atualizar
  somente o estado da pesquisa, sem sobrescrever o estado terminal da ingestão.
- When uma requisição externa admitir fallback configurado, the system shall
  tentar as alternativas elegíveis antes de declarar falha terminal.
- When o TikTok devolver uma resposta de challenge ou extração inesperada, the
  system shall repetir a extração com impersonação compatível antes de orientar
  nova tentativa, configuração de acesso ou upload manual.
- When registros legados contiverem pendência de Brain já resolvida, the system
  shall reconciliá-los idempotentemente sem repetir a ingestão canônica.

### State-driven (durante um estado)

- While uma etapa derivada estiver aguardando repetição automática, the system
  shall manter a pendência observável e impedir que ela seja apresentada como
  falha da ingestão canônica.
- While uma pesquisa complementar estiver indisponível, the system shall manter o
  conteúdo principal acessível e a pendência de pesquisa identificada
  separadamente.

### Optional (feature opcional)

- Where um fallback de modelo estiver configurado, the system shall registrar
  qual rota efetivamente respondeu sem expor credenciais.
- Where uma fonte pública oferecer metadados determinísticos, the system shall
  poder usá-los como fallback seguro quando a análise enriquecida não estiver
  disponível.

### Unwanted behavior (condições de erro)

- If uma tentativa não adquirir exclusividade temporária do Brain, then the
  system shall não classificar essa contenção isolada como falha terminal.
- If o provedor retornar uma resposta não retentável, then the system shall não
  reduzi-la a erro inesperado sem código e etapa identificáveis.
- If todas as tentativas automáticas forem esgotadas, then the system shall parar
  o loop, preservar o estado utilizável e oferecer uma ação manual compatível com
  a etapa que falhou.
- If uma repetição manual for solicitada para uma pendência já resolvida, then the
  system shall reconciliar o estado sem executar novamente etapas canônicas ou
  chamadas externas desnecessárias.

## Critérios de Aceite

- [ ] Dois jobs simultâneos do mesmo workspace não permanecem com pendência de
  Brain apenas porque um deles encontrou o lease ocupado.
- [ ] Um job com Brain posteriormente reconciliado muda para concluído e perde a
  mensagem antiga sem repetir a ingestão canônica.
- [ ] A reparação de registros legados é idempotente e só promove jobs cujas
  etapas obrigatórias estejam verificavelmente concluídas.
- [ ] Eventos de pesquisa complementar não alteram o estágio terminal da
  ingestão nem substituem sua mensagem de erro.
- [ ] Pesquisa complementar expõe estado e ação próprios quando esgota as
  tentativas, mantendo o conteúdo principal utilizável.
- [ ] Falhas OpenRouter preservam código seguro, etapa, HTTP status quando
  disponível e identificador de requisição quando seguro.
- [ ] A análise do X usa fallback configurado e retorna mensagem acionável quando
  todos os caminhos forem rejeitados.
- [ ] O fluxo do TikTok reconhece resposta inesperada, tenta impersonação e retorna
  mensagem específica se ainda não conseguir extrair.
- [ ] O admin consegue distinguir configuração ausente, autenticação rejeitada,
  rate limit, indisponibilidade e payload recusado sem acessar dados sensíveis.
- [ ] Testes automatizados cobrem reconciliação, concorrência, estados separados,
  fallbacks e sanitização de diagnósticos.
- [ ] O deploy aplica qualquer reparação necessária sem indisponibilidade
  prolongada e mantém web, worker, banco e cache saudáveis.

## Fora de Escopo

- Garantir extração de conteúdo privado, removido, regionalmente bloqueado ou que
  exija credenciais que o operador não configurou.
- Eliminar indisponibilidades dos provedores externos.
- Reprocessar automaticamente os jobs históricos cuja ingestão canônica falhou.
- Introduzir billing, quotas comerciais ou isolamento multi-tenant adicional.

## Riscos / Decisões pendentes

- A promoção automática deve ser conservadora: na dúvida sobre uma etapa
  obrigatória, o job permanece com pendência.
- Pesquisa complementar continua opcional para a disponibilidade do conteúdo e
  não bloqueia a conclusão da ingestão canônica.
- Diagnósticos externos devem privilegiar códigos e headers allowlisted; corpos de
  resposta permanecem fora do banco e dos logs.
