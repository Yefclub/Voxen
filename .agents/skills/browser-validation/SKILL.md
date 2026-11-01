---
name: browser-validation
description: Use quando for validar interface no navegador ("confere essa tela", "o layout quebrou?", "testa esse fluxo visual") — descobre ferramentas e alvo autorizado, fixa a revisão carregada e separa checagem headless de inspeção visível, com evidência observada.
---

# Browser Validation — interface com evidência observada

Validação de UI sem achismo: ferramenta descoberta, alvo autorizado e revisão carregada são registrados antes de qualquer afirmação; checagem headless não substitui inspeção visível.

## Quando usar

- Antes de declarar uma tela pronta, corrigida ou sem regressão visual.
- Quando um fluxo depende de estado autenticado, rota, viewport ou dado real.
- Nunca como substituto de `review-pr`, testes, typecheck ou CI verde.

## Fluxo

### 1. Descobrir ferramentas e alvo autorizado

- Listar as ferramentas de navegador efetivamente disponíveis na sessão (sem presumir complementos instalados fora do projeto).
- Fixar o alvo autorizado: URL/rota, usuário/papel, viewport e dados de entrada. Fora do alvo autorizado, parar e pedir decisão.
- Identificar a revisão carregada de fato (SHA/versão exibida ou resposta de versão), não a revisão que "deveria" estar no ar.

### 2. Separar headless de visível

- Headless (sem renderização): asserções de DOM/estado, console sem erros novos, rede sem 4xx/5xx inesperados.
- Visível (com renderização): captura de tela da revisão fixada, comparação contra o comportamento esperado, anotação do que foi olhado.
- Uma passada headless verde não declara aprovação visual; uma captura sem revisão fixada não prova nada.

### 3. Concluir com evidência

- Registrar: ferramenta usada, alvo, revisão carregada, checagens headless (comandos + saída) e inspeção visível (captura vinculada à revisão).
- Regressão visual exige antes/depois na mesma revisão-base e mesmo viewport.
- Sem evidência observada na revisão fixada, o veredito é **não verificado** — nunca "passou".

## O que esta skill NÃO faz

- Não redesenha UI nem duplica política de design (questão visual de produto segue as regras de UI existentes).
- Não publica, não altera dados de produção, não testa credenciais reais além do alvo autorizado.
- Não substitui `test-audit` (contrato dos testes), `debug` (causa raiz) nem `ci-status` (leitura do CI).
