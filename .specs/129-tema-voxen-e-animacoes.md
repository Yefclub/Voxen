# 129 — Tema Voxen e animação de ícones

## Contexto

Dois ajustes de identidade e polimento, ambos transversais à interface:

1. **Tema padrão sem nome próprio.** O tema padrão da aplicação se chama
   `linear` — nome herdado da referência visual que inspirou a paleta, não
   do produto. Deve continuar sendo o padrão, mas passar a se chamar
   "Voxen" para o usuário. Hoje o identificador aparece em
   `apps/web/src/client/lib/theme.ts` (`APP_THEMES`, `DEFAULT_THEME`,
   `DARK_THEMES`), no CSS (`[data-theme='linear']` em
   `apps/web/src/client/index.css`), na extensão (`apps/extension/theme.css`,
   `theme-init.js`) e no valor persistido por usuário.
2. **Ícones sem animação de entrada.** Ao abrir uma página ou ao
   abrir/fechar a sidebar, os ícones aparecem estáticos. O comportamento
   desejado é que executem sua animação nesses momentos.

## Glossário

- **Rótulo do tema**: o nome exibido ao usuário na seleção de tema.
- **Identificador do tema**: o valor técnico persistido e usado em
  `data-theme`.

## Requisitos

### Ubiquitous

- The system shall apresentar ao usuário o tema padrão com o rótulo
  "Voxen".
- The system shall manter o tema padrão como o tema aplicado quando o
  usuário nunca escolheu outro.
- The system shall respeitar `prefers-reduced-motion` em toda animação de
  ícone introduzida.

### Event-driven

- When o usuário abre uma página, the system shall executar a animação dos
  ícones dessa página.
- When a sidebar é aberta ou fechada, the system shall executar a animação
  dos ícones envolvidos.

### Unwanted behavior

- If um usuário já tem o tema padrão persistido sob o identificador
  anterior, then the system shall continuar aplicando o mesmo tema após a
  renomeação — sem reverter a escolha do usuário nem exibir tema errado.

## Critérios de Aceite

- [ ] Seleção de tema mostra "Voxen" no lugar do rótulo anterior, e segue
      sendo o padrão.
- [ ] Usuário com o tema padrão já persistido continua vendo o mesmo tema
      após a mudança (sem regressão de dado existente).
- [ ] A extensão continua aplicando o tema corretamente (ela espelha os
      identificadores de tema do app — ver spec 122).
- [ ] Ícones animam ao abrir página e ao abrir/fechar a sidebar.
- [ ] `prefers-reduced-motion` respeitado.
- [ ] Testes cobrindo a compatibilidade do identificador persistido.

## Fora de Escopo

- Mudança de paleta ou criação de tema novo — é renomeação, não redesenho.
- Animação de outros elementos além de ícones.
- Renomear os demais temas (`zinc`, `emerald`, `light`).

## Decisões tomadas na implementação

- **Só o rótulo muda; o identificador segue `linear`.** O nome exibido vive
  em `theme.linear` no i18n (PT-BR e EN) e virou "Voxen". `APP_THEMES`,
  `DEFAULT_THEME`, `[data-theme='linear']`, a coluna `theme` da conta e o
  espelho da extensão ficam intactos. Nenhuma migração de dado, nenhum
  usuário perde o tema, e a extensão não precisou ser tocada. A separação
  entre identificador e rótulo está documentada em `lib/theme.ts`.

- **As deixas de animação de ícone são duas, e só duas.** O gesto foi
  calibrado em `lib/icon-cue.ts` (duração 0.55s contra o padrão 1s do
  pacote, stagger de 45ms, atraso inicial para o container assentar):
  - **Abrir página** → anima apenas o ícone do `PageHeader`, o que nomeia a
    página, 120ms depois do início da timeline do `PageShell`. Um ícone por
    página; animar a tela inteira a cada rota vira ruído.
  - **Abrir/fechar sidebar** → varre em cascata os ícones de navegação do
    painel (expandido) ou do rail (colapsado), 160ms após o spring do
    painel. Dispara só na troca de estado, não no primeiro carregamento —
    aí quem pontua é o cabeçalho da página.

  Tudo o mais (botões, tabelas, cards) continua estático. As deixas entram
  depois das transições existentes em vez de concorrer com elas.

- **Ícones passaram a expor `ref`** com o handle `startAnimation` /
  `stopAnimation` do `@animateicons/react`. Anexar uma ref faz o pacote
  parar de animar o hover sozinho e delegar aos handlers de mouse, então o
  wrapper em `components/ui/icons.ts` reproduz o hover nativo — anexar a ref
  não custa a animação de hover que já existia.

- **`prefers-reduced-motion`** é barrado em três camadas: o grupo de deixas
  não agenda timers, o wrapper de ícone não chama `startAnimation`, e o
  próprio pacote ignora o comando.
