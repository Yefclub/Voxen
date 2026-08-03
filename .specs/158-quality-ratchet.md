# Spec 158 — Repository quality ratchet

## Context

Voxen already blocks pull requests on formatting, lint, type checking, tests,
container builds and security scans. Those checks reject known defects, but
they do not prevent gradual deterioration in measurable maintainability. The
current repository also contains legitimate legacy debt—large modules and
incomplete coverage—so introducing ideal absolute thresholds would make the
gate impossible to adopt.

The approved direction follows the quality-gate model described in the
provided Lucas Montano transcript: freeze today's measurable state as a
baseline, reject regressions, allow equal or improved results, and publish
machine-readable evidence that a coding agent can consume while babysitting a
pull request.

## Glossary

- **Baseline**: the committed maximum debt/minimum coverage accepted when the
  ratchet is introduced.
- **Ratchet**: a comparison that permits equal or better metrics but never a
  worse result.
- **Oversized file**: a tracked production source file above its configured
  line limit.
- **Quality artifact**: JSON metrics, a Markdown summary and duplication data
  retained by GitHub Actions for humans and coding agents.

## Requirements

### Ubiquitous

- The quality gate shall measure TypeScript/JavaScript coverage, Python worker
  coverage, cross-language duplication and oversized production source files.
- The gate shall compare pull-request metrics against a versioned baseline in
  the repository.
- Existing debt shall be admitted at its current value without requiring an
  unrelated repository-wide refactor in this pull request.
- Metric parsing and comparison shall be deterministic and covered by tests.
- Generated code, dependencies, build output, migrations, tests and fixtures
  shall not count as production source for duplication or file-size debt.
- Numeric comparisons shall use documented rounding so harmless floating-point
  representation cannot flip a build.

### Event-driven

- When CI runs the web test suite, it shall produce LCOV without executing the
  suite a second time.
- When CI runs worker tests, it shall produce a JSON coverage report without
  executing the suite a second time.
- When both test jobs complete, a dedicated quality job shall download their
  reports, collect duplication and source-size metrics, and evaluate the
  ratchet.
- When the gate finishes, it shall always write the current metrics and a
  concise Markdown diagnosis before returning success or failure.
- When running in GitHub Actions, the Markdown diagnosis shall be copied to the
  job summary and all quality reports shall be uploaded as one artifact even
  when the ratchet fails.

### State-driven

- While a current coverage value is equal to or above its baseline, that metric
  shall pass.
- While current duplication is equal to or below its baseline, that metric
  shall pass.
- While a legacy oversized file is equal to or smaller than its recorded
  allowance, that file shall pass.
- While a source file remains at or below the configured line limit, it shall
  not require an individual baseline entry.
- While a pull request tightens the committed baseline, the gate shall accept
  the baseline change.

### Unwanted behavior

- If coverage decreases, duplication increases, a legacy oversized file grows,
  or a new file crosses the line limit, the gate shall fail with the current
  value, allowed value and affected file when applicable.
- If a required report is absent or malformed, the gate shall fail closed and
  explain which producer/report is missing.
- If a pull request edits the baseline to lower coverage, raise duplication,
  raise a file-size threshold or increase an existing file allowance, the gate
  shall reject the attempted relaxation against the target branch baseline.
- The initial baseline shall not be silently recomputed during ordinary CI.
- The workflow shall not create recurring pull-request comments or expose
  secrets in artifacts.

## Agent handoff contract

The uploaded artifact shall have a stable name and contain:

- `metrics.json`: normalized values and oversized-file inventory;
- `summary.md`: pass/fail table plus actionable regressions;
- `jscpd-report.json`: detailed duplicate locations produced by the collector;
- the raw web and worker coverage reports used as evidence.

The Codex and Claude shipping instructions shall tell an agent to download and
read this artifact whenever the quality job fails, address every regression,
push the correction and continue monitoring the same pull request.

## Acceptance criteria

- [x] A committed baseline records the measured state of the synchronized
      `dev` branch at adoption time.
- [x] Tests cover equality, improvements, every regression category, malformed
      input and forbidden baseline relaxation.
- [ ] CI produces coverage once per existing test job and evaluates a separate
      required-quality job.
- [x] A deliberate fixture regression makes the comparator fail with an
      actionable message.
- [x] The complete artifact is uploaded on both success and failure.
- [x] Local format, lint, typecheck, tests and production build pass.
- [ ] The pull request has green CI and an independent review.

## Out of scope

- Refactoring all existing oversized modules in the adoption pull request.
- Enforcing aspirational absolute coverage percentages unrelated to the
  measured baseline.
- Validating Prisma migration history or applying migrations to shadow
  databases; that is a separate migration-gate feature.
- Posting or resolving GitHub review conversations automatically.
- Replacing CodeQL, ESLint, Ruff, mypy, Trivy or the existing security jobs.

> 2026-08-03: implementation approved by the owner after the product/CI study.
> The supplied video transcript is the requirements source for baseline,
> ratchet, CI summary and agent-consumable artifacts.
