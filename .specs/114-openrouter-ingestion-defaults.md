# Spec 114 — Configuração simples e enriquecimento confiável

## Status

Aprovado pelo owner em 2026-07-29.

## Contexto

O onboarding atual pede a chave da OpenRouter e exige que o administrador escolha
vários modelos antes de usar a aplicação. Isso aumenta o atrito inicial e permite
combinações incompletas. A configuração administrativa de modelos continua
necessária para ajustes posteriores, mas a primeira execução deve funcionar com
um conjunto coerente de padrões.

PDFs também precisam usar o parser especializado da Mistral oferecido pela
OpenRouter, enquanto os demais documentos continuam sendo extraídos com
MarkItDown e imagens continuam sendo analisadas pela OpenRouter. Tags e Brain são
enriquecimentos automáticos: uma indisponibilidade momentânea não pode deixar o
conteúdo permanentemente incompleto nem exigir que o usuário visite `/grafo`.

## Glossário

- **Configuração automática**: persistência dos modelos padrão ao validar a
  primeira chave da OpenRouter.
- **Enriquecimento pendente**: conteúdo ativo que ainda não possui o resultado
  esperado de tags ou indexação do Brain.
- **Passe de reconciliação**: processamento periódico e idempotente de
  enriquecimentos pendentes.

## Requisitos

### Ubiquitous

- The system shall manter uma tela administrativa onde modelos de texto,
  transcrição, visão, documentos, pesquisa e análise do X possam ser alterados
  depois do onboarding.
- The system shall usar `x-ai/grok-4.5` como padrão de texto, visão, documentos,
  pesquisa e análise do X.
- The system shall usar `x-ai/grok-stt-1.0` como padrão de transcrição.
- The system shall enviar PDFs para a OpenRouter com o parser Mistral OCR.
- The system shall converter documentos não-PDF suportados com MarkItDown antes
  da análise pela OpenRouter.
- The system shall manter análise de imagens e transcrição remota na OpenRouter.
- The system shall tratar geração de tags e materialização do Brain como
  operações idempotentes e escopadas ao usuário.

### Event-driven

- When o administrador validar a chave da OpenRouter no onboarding, the system
  shall persistir atomicamente a chave e todos os modelos padrão sem pedir
  seleção de modelos.
- When um conteúdo elegível concluir a ingestão, the system shall tentar gerar
  tags estruturadas com raciocínio desabilitado e orçamento suficiente para a
  resposta.
- When um conteúdo novo ou alterado ainda não estiver materializado no Brain,
  the system shall reconciliá-lo em segundo plano sem depender da abertura de
  `/grafo`.
- When uma tentativa de tags retornar uma lista vazia ou falhar de forma
  transitória, the system shall manter o conteúdo elegível para uma tentativa
  posterior.

### State-driven

- While uma chave válida estiver configurada, the system shall permitir que o
  administrador troque modelos na tela de configuração sem reenviar a chave.
- While houver conteúdos ativos sem tags, the system shall processar um lote
  limitado em segundo plano sem bloquear jobs de ingestão.
- While houver conteúdos ativos com índice do Brain ausente ou desatualizado,
  the system shall processar um lote limitado em segundo plano.

### Optional

- Where um modelo administrativo for limpo, the system shall voltar ao padrão
  correspondente em vez de deixar a capacidade sem modelo.
- Where um PDF não puder ser processado pelo parser remoto, the system shall
  registrar diagnóstico seguro e aplicar o fallback documental suportado.

### Unwanted behavior

- If a chave da OpenRouter for inválida, then the system shall não persistir a
  chave nem qualquer modelo padrão.
- If um modelo padrão obrigatório não estiver disponível para a chave, then the
  system shall rejeitar a conclusão do onboarding com orientação clara.
- If a geração automática de tags falhar, then the system shall não falhar nem
  reverter a ingestão concluída.
- If a geração automática de tags falhar seis vezes, then the system shall
  interromper retries automáticos e preservar o diagnóstico para ação manual.
- If o lease compartilhado do Brain estiver ocupado, then the system shall
  preservar o conteúdo como pendente para o próximo passe.
- If o conteúdo já possuir tags válidas ou índice atual, then the system shall
  não repetir custo ou mutação desnecessária.

## Critérios de Aceite

- [ ] O onboarding solicita a chave da OpenRouter, valida os modelos exigidos,
      salva os padrões e avança sem exibir seletores.
- [ ] A tela administrativa de modelos permanece disponível e começa com os
      padrões definidos nesta spec.
- [ ] Chave inválida ou catálogo sem modelo obrigatório não deixa configuração
      parcial persistida.
- [ ] Payload de PDF usa `mistral-ocr`; documento não-PDF continua no
      MarkItDown; imagem e áudio continuam remotos.
- [ ] Geração de tags pede saída JSON estruturada, desabilita raciocínio e não
      usa limite de resposta insuficiente.
- [ ] Conteúdos ativos sem tags são reconciliados automaticamente em lotes
      limitados e itens já tagueados são ignorados.
- [ ] Conteúdos novos ou alterados são reconciliados no Brain sem visita à
      página e convergem após disputa de lease.
- [ ] Testes focados de API, payload e reconciliação passam sem Docker nem
      Playwright local.

## Fora de Escopo

- Provedores de IA além da OpenRouter.
- Transcrição local.
- Remover a tela administrativa de modelos.
- Executar Docker ou Playwright localmente.
- Alterar a biblioteca de visualização do grafo.

## Riscos / Decisões pendentes

- A disponibilidade dos identificadores padrão depende do catálogo da
  OpenRouter. O onboarding valida o catálogo antes de persistir.
- O parser Mistral OCR pode aumentar custo em PDFs longos; o custo continua
  registrado no evento documental existente.
