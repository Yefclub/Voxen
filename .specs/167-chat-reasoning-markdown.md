# Spec 167 — Markdown no raciocínio do chat

## Contexto

O texto de raciocínio emitido pelos modelos é exibido atualmente em um parágrafo literal. Listas, ênfases, títulos e blocos de código aparecem como marcadores brutos, embora a resposta final já possua um renderer Markdown seguro e preparado para streaming.

## Requisitos

### R1 — Renderização

- **Quando** um segmento de raciocínio contiver Markdown, **então** ele deve ser renderizado com o mesmo componente seguro usado na resposta final.
- **Enquanto** o segmento estiver incompleto, **então** a renderização deve aceitar Markdown parcial sem provocar troca do bloco recolhível.
- **Quando** o provedor não emitir texto, **então** os rótulos operacionais existentes devem continuar visíveis.

### R2 — Segurança e hierarquia visual

- **Quando** o raciocínio contiver HTML ou URLs inseguras, **então** as proteções existentes do renderer devem continuar aplicadas, sem `rehype-raw`.
- **Quando** títulos, listas ou código forem renderizados, **então** devem manter escala compacta e tom visual secundário dentro da timeline de raciocínio.

## Aceite

- [x] Segmentos de raciocínio usam `Markdown` em vez de interpolação em `<p>`.
- [x] O fallback de raciocínio vazio permanece traduzido.
- [x] O bloco continua recolhível e ordenado com as ferramentas.
- [x] O estilo do Markdown de raciocínio é menor e secundário.
- [x] Nenhuma opção permissiva de HTML foi adicionada.
