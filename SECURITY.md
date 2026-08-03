# Security Policy

Thank you for helping keep Voxen secure.

## Supported versions

Voxen is currently in the `0.x` series. Only the latest published release and
the `main` branch receive security fixes.

| Version                 | Supported      |
| ----------------------- | -------------- |
| Latest `v0.x.y` release | Yes            |
| `main`                  | Yes            |
| Older releases          | Not guaranteed |

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use GitHub private
vulnerability reporting through **Security → Report a vulnerability**.

If that channel is temporarily unavailable, contact the maintainer privately
through their GitHub profile and share only the minimum information needed to
establish a secure channel.

Please include, when possible:

- affected version or commit;
- minimal reproduction steps;
- expected impact;
- logs or examples without real secrets;
- a suggested remediation, if known.

## Response process

- Initial acknowledgement: best effort within 7 days.
- Triage and severity assessment: best effort within 14 days.
- Remediation: prioritized by impact and complexity.
- Public disclosure: only after a fix or mitigation is available.

## Scope

In scope:

- authentication or authorization bypass;
- cross-user data exposure;
- secret disclosure;
- SSRF, RCE, path traversal, or command injection;
- supply-chain, container image, or CI workflow compromise.

Out of scope:

- attacks requiring root access to the host;
- issues caused by weak or exposed production environment values;
- intentional administrator usage that consumes rate limits or model budget;
- known dependency vulnerabilities with no applicable Voxen exploit.

See the [technical security model](docs/en/SECURITY.md) for implementation
details.
