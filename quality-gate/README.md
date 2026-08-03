# Quality Gate

Voxen uses a ratchet instead of aspirational thresholds that would fail on
existing debt. [`baseline.json`](./baseline.json) freezes the measured state at
adoption time:

- web and worker line coverage may stay equal or increase;
- duplicated-line percentage may stay equal or decrease;
- a legacy file above 500 lines may stay equal or shrink;
- a new file may not cross 500 lines.

The comparator also reads the target branch's baseline on pull requests. A PR
therefore cannot make a regression green by weakening the committed values.
Baseline edits are valid only when they tighten a metric after a real
improvement.

## Local check

Generate the two coverage inputs with the same database-backed commands used by
CI, then run:

```bash
pnpm quality:duplicates
pnpm quality:check
```

The normalized result is written to `quality-gate/output/metrics.json`, and the
human diagnosis to `quality-gate/output/summary.md`. Input and output folders
are ignored; only the baseline and this documentation are versioned.

## Pull-request failure

The `Quality Gate` job always uploads `quality-gate-report`. An agent can fetch
it with the failing workflow run ID:

```bash
gh run download <run-id> -n quality-gate-report -D /tmp/voxen-quality-gate
```

Read `summary.md` first. `metrics.json` is the stable machine contract,
`jscpd-report.json` contains duplicate locations, and `raw/` contains the exact
coverage evidence. Fix every regression on the feature branch and let the same
PR run again; do not raise allowances.

## Coverage semantics

Python coverage uses `pytest-cov --cov=src`, which includes unimported worker
modules. Bun LCOV reports only loaded modules, so the collector adds every
tracked, non-generated web source absent from LCOV as zero-covered code. Blank
and comment-only lines are excluded from that fallback denominator. This keeps
new untested modules from bypassing the ratchet while allowing explanatory
comments without a coverage penalty.
