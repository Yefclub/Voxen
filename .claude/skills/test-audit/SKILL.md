---
name: test-audit
description: Use quando testes forem alterados ou antes de declarar CI verde ("a cobertura está boa?", "posso remover esse teste?", "o que esse teste prova?") — mapeia cada teste ao contrato de comportamento que ele prova, aponta testes que só espelham a implementação e protege comportamentos que nunca podem ser removidos para obter verde.
---

# Test Audit — cobertura que prova comportamento

Auditoria de suíte: cada teste precisa provar um contrato observável. Teste que só repete a implementação com outras palavras não protege nada e trava refatoração legítima.

## Quando usar

- Depois de alterar testes (novos, modificados, deletados).
- Antes de declarar cobertura suficiente para merge.
- Quando um teste falha e a correção proposta é "ajustar o teste" — auditar primeiro se o teste ou o comportamento está errado.

## Fluxo

### 1. Mapear teste → contrato

Para cada arquivo em `apps/web/tests/` (e `scripts/*.test.mjs`) tocado ou relevante, listar:

- **Comportamento provado** (observável por cliente/DB/rede): o que quebraria em produção se o teste sumisse?
- **Evidência**: comando executado + saída real (não "rodei e passou" sem output).

### 2. Sinalizar testes-espelho

Teste-espelho só repete a implementação (mesma lógica, mesmos literais) e falha junto com qualquer refatoração interna sem quebrar comportamento. Marcar para reescrever em torno do contrato ou remover, **exceto** quando ele trava regressão real documentada (linkar issue/commit).

### 3. Proteger comportamentos nucleares

Estes nunca saem para obter verde — se falham, o defeito é do código ou do ambiente, nunca do teste:

- Isolamento por workspace (`userId` em toda query; matriz de isolamento).
- Idempotência de ingestão e guards de revisão (`duplicate`, 409 vs duplicata).
- Orçamentos e concorrência MCP (limites, `MCP_BUSY`, cursor assinado).
- Preservação em upgrades (migrations forward, backup/restore, jobs pendentes).
- Contratos públicos de output (schemas MCP, `tools/list`).
- Portões de segurança (gitleaks, dependências auditadas, CodeQL onde aplicável).

### 4. Veredito

- **Cobertura real**: lista teste → contrato, por arquivo:linha.
- **Lacunas**: comportamento da spec/issue sem teste correspondente.
- **Remoções propostas**: só com justificativa de que nenhum contrato perde prova.

## O que esta skill NÃO faz

- Não edita testes nem código (audita e reporta; quem implementou decide).
- Não aprova merge sozinha — alimenta o review (`review-pr`) e a decisão do owner.
- Não troca evidência observável por relato ("confia, passou").
