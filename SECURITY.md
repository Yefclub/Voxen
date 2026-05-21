# Politica de Seguranca

Obrigado por ajudar a manter o Voxen seguro.

## Versoes suportadas

O Voxen ainda esta em fase `0.x`. Apenas a ultima release publicada e a branch `main` recebem correcao de seguranca.

| Versao | Suporte |
|---|---|
| Ultima release `v0.x.y` | Sim |
| `main` | Sim |
| Releases antigas | Nao garantido |

## Reportando vulnerabilidades

Nao abra issue publica para vulnerabilidades.

Use o GitHub private vulnerability reporting pelo botao "Report a vulnerability" na aba Security do repositorio.

Se o canal privado estiver temporariamente indisponivel, abra um contato privado com o mantenedor pelo perfil GitHub e inclua apenas o minimo necessario ate existir um canal seguro.

Inclua, quando possivel:

- Versao ou commit afetado.
- Passos para reproduzir.
- Impacto esperado.
- Logs ou exemplos sem secrets reais.
- Sugestao de correcao, se houver.

## Processo esperado

- Confirmacao inicial: melhor esforco em ate 7 dias.
- Triagem e severidade: melhor esforco em ate 14 dias.
- Correcao: priorizada conforme impacto e complexidade.
- Divulgacao publica: somente depois da correcao ou mitigacao estar disponivel.

## Escopo

Dentro do escopo:

- Bypass de autenticacao/autorizacao.
- Vazamento de dados entre usuarios.
- Exposicao de secrets.
- SSRF, RCE, path traversal, command injection.
- Supply chain, imagens Docker e workflows de CI.

Fora do escopo:

- Ataques que exigem acesso root ao host.
- Problemas causados por `.env` de producao fraco ou exposto pelo operador.
- Rate limits/custos causados por uso intencional do proprio admin.
- Vulnerabilidades ja conhecidas em dependencias sem exploit aplicavel ao Voxen.

## Mais detalhes

O threat model e os controles tecnicos ficam em [docs/SECURITY.md](docs/SECURITY.md).
