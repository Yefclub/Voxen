# Spec 135 — Autoscroll para raciocínio longo no chat

## Contexto

Ao enviar uma mensagem, o chat mantém a pergunta como âncora visual enquanto a
resposta começa. Hoje essa âncora bloqueia o acompanhamento automático quando a
IA transmite apenas raciocínio ou ferramentas. Se o raciocínio se torna maior
que a área visível antes do texto final, o conteúdo novo deixa de aparecer sem
uma rolagem manual.

## Glossário

- **Âncora**: posição que mantém a mensagem enviada visível no início de um turno.
- **Follow**: acompanhamento automático do fim do conteúdo em crescimento.
- **Raciocínio**: segmentos transmitidos pela IA antes ou entre trechos de texto final.

## Requisitos

### Ubiquitous (sempre verdadeiros)

- The system shall preservar uma rolagem manual da pessoa e não reposicionar a conversa automaticamente enquanto ela estiver afastada do fim.
- The system shall manter a âncora inicial enquanto o conteúdo de raciocínio ainda couber na área visível.

### Event-driven (resposta a evento)

- When o raciocínio ou uma ferramenta em crescimento alcançar o limite visível da conversa, the system shall ativar o follow para exibir o conteúdo mais recente.
- When a pessoa usar o controle para voltar ao conteúdo mais recente, the system shall retomar o follow normalmente.

### State-driven (durante um estado)

- While um turno estiver transmitindo somente raciocínio ou ferramentas e a pessoa não tiver rolado manualmente para cima, the system shall acompanhar o crescimento depois que a âncora for consumida.

### Optional (feature opcional)

- Where não houver espaço suficiente para manter uma âncora útil, the system shall iniciar o turno acompanhando o fim do conteúdo.

### Unwanted behavior (condições de erro)

- If a alteração geométrica ocorrer sem conteúdo suficiente para alcançar o limite visível, then the system shall não abandonar a âncora nem exibir o controle de conteúdo mais recente indevidamente.

## Critérios de Aceite

- [ ] Um raciocínio longo faz a conversa acompanhar os segmentos novos antes do texto final.
- [ ] Um raciocínio curto mantém a mensagem enviada ancorada, sem salto ao fim.
- [ ] Rolar manualmente para cima interrompe o follow e preserva a posição escolhida.
- [ ] O controle de conteúdo mais recente restabelece o follow.
- [ ] A lógica é coberta por testes unitários do cálculo de rolagem e por contrato da página.

## Fora de Escopo

- Alterar o formato ou o conteúdo dos segmentos de raciocínio fornecidos pela IA.
- Mudar a política de exibição/colapso dos blocos de raciocínio.
- Adicionar streaming persistente em outra rota do produto.

## Riscos / Decisões pendentes

- O follow deve considerar a geometria real da conversa para não transformar um raciocínio curto em salto automático.

> 2026-08-02: abordagem aprovada explicitamente pelo usuário antes da implementação.
