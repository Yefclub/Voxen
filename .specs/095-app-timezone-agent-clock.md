# Spec 095 — Fuso horário da instância e relógio do agente

## Contexto

A Vox não tinha um fuso configurável da instância. Perguntas como “o que entrou
hoje / esta semana” dependiam do modelo adivinhar UTC vs horário local, e
automações já usam IANA por regra — mas o chat e o onboarding não. Esta spec
define um fuso GLOBAL da instância (self-hosted single-tenant), configurável no
onboarding e em configurações admin, e injeta um relógio rico no prompt do
agente a cada turno.

## Glossário

- **Fuso da instância**: IANA timezone (ex.: `America/Sao_Paulo`) persistido em
  settings GLOBAL (`app_timezone`).
- **Relógio da instância**: snapshot calculado em runtime (agora local, dia da
  semana, offset UTC, início do dia/semana local em ISO UTC).

## Requisitos

### Ubiquitous

- The system shall persist an instance timezone as an IANA identifier in global
  settings, defaulting to `America/Sao_Paulo` when unset or invalid.
- The system shall expose helpers to validate IANA timezones and to compute a
  full clock snapshot (local date/time, weekday, UTC offset, start of local day
  and local week as UTC ISO timestamps).
- The system shall inject the clock snapshot into the in-app agent instructions
  on every chat turn so the model can resolve “hoje”, “esta semana” and
  relative windows without guessing.
- The system shall keep the timezone global (instance-wide), not per-user, in
  line with single-tenant self-hosted positioning.

### Event-driven

- When the admin finishes onboarding, the system shall accept and persist
  `app_timezone` together with language/signups.
- When the admin saves setup or patches instance settings, the system shall
  accept and persist a validated `app_timezone`.
- When a chat turn starts streaming, the system shall append a trusted
  `<instance_clock>` block (not untrusted library metadata) with current clock
  facts and guidance to convert local calendar phrases to ISO UTC for tools.

### Unwanted behavior

- If the submitted timezone is empty or not a valid IANA zone, then the system
  shall reject the write with 400 (API) or fall back to the default when reading.
- If timezone is missing from older installs, then reads shall use the default
  without migration SQL (settings row created on first write).

## Critérios de Aceite

- [ ] Setting `app_timezone` tipado + `getAppTimezone` / validação IANA.
- [ ] Onboarding + admin instance + setup leem/escrevem o fuso.
- [ ] `streamAssistantReply` inclui relógio (data, hora, weekday, offset, marcos UTC).
- [ ] Testes unitários do snapshot e contratos de source/API.
- [ ] Changelog unreleased com frontmatter válido.

## Fora de Escopo

- Fuso por usuário (multi-timezone no mesmo deploy).
- Alterar o `timezone` por automação (já existe por regra).
- UI de seletor com mapa mundial / todos os ~400 zones (lista comum + validação livre basta).
