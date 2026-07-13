---
tipo: fix
titulo: Chat quebrava para sempre após aprovar criação de nota via IA
---

Corrigido crash que derrubava o chat inteiro (tela "Algo deu errado") sempre que uma conversa com uma confirmação de nota aprovada era carregada. A causa era um dado malformado gravado na mensagem de confirmação, que o render de ferramentas não conseguia interpretar. Também foi adicionada uma validação de segurança para que dados malformados (deste ou de qualquer bug futuro) nunca mais consigam quebrar o chat inteiro — são simplesmente ignorados no render.
