# Security-audit fixtures — como ler este diretório

Cada fixture é um exemplo sintético e sanitizado (sem segredos, sem código
executável) de uma classe de veredito do contrato da skill `security-audit`:

| Fixture                       | Classe esperada                                         |
| ----------------------------- | ------------------------------------------------------- |
| `confirmed-finding.md`        | achado **confirmado** pela instância verificadora       |
| `refuted-candidate.md`        | candidato **refutado** (não vira achado final)          |
| `missing-evidence.md`         | evidência ausente → **não verificado**, nunca aprovação |
| `partial-inventory.md`        | inventário parcial com lacunas visíveis                 |
| `zero-findings-unverified.md` | zero achados com cobertura incompleta → não é aprovação |

Regras:

- Referências `arquivo:linha` apontam para arquivos reais do snapshot fixado
  na própria fixture (ver campo `snapshot`).
- Nenhuma fixture contém segredos, tokens, transcrições ou dumps.
- O teste `scripts/security-audit-fixtures.test.mjs` valida presença,
  espelho `.agents/`, classe declarada e sanitização.
