# Spike 768 — Vercel AI Elements for the chat interface

**Verdict: take the patterns, not the components. Do not adopt AI Elements.**

Deliverable of issue #768. Every claim below was verified by running the tool or
reading the source, not by reading marketing pages. Where a claim rests on a
single observation, it says so.

## The question the issue asked first

> Does installing AI Elements in a Vite app without `components.json` work at all
> without disturbing the existing `components/ui/` tree?

**It works.** #770 added a hand-written `components.json`, and `shadcn add`
resolves the `@ai-elements` namespace without `shadcn init` ever running. That
half of the blocker is gone.

**It disturbs the tree anyway**, for a reason the issue did not anticipate. The
AI Elements registry items declare their own `target`:

```json
"target": "components/ai-elements/shimmer.tsx"
```

An explicit `target` overrides both the `components` alias and the `-p` flag —
tested both. Files land in `src/components/ai-elements/`, outside
`src/client/`, creating an eighth directory under `src/` that matches no
existing pattern. It compiles, because the tsconfig `include` is `src/**/*`, and
the `@/…` imports inside resolve. It is simply not where this app keeps client
code, and the CLI offers no way to say otherwise.

## Measured cost per candidate

Each row is `shadcn add @ai-elements/<name> --dry-run`, run against this
repository at `31b176f`.

| Component | Files | New deps | Overwrites |
| --- | --- | --- | --- |
| `sources` | 2 | 2 | — |
| `context` | 4 | 3 | `button.tsx` |
| `reasoning` | 3 | 9 | — |
| `tool` | 6 | 4 | `badge.tsx`, `button.tsx`, `select.tsx` |

The overwrites are the sharp edge. `button`, `badge` and `select` already went
through the manual pass onto `--color-app-*`. The CLI prompts per file before
replacing them, so nothing is lost silently — but adopting `tool` means either
declining the overwrite and hand-merging, or accepting it and redoing the
restyle.

`reasoning` pulling nine dependencies for one collapsible block is the other
outlier. Four of them are `@streamdown/*` plugins for CJK, code, math and
mermaid rendering that this chat does not use.

## Five findings that decide it

**1. `Conversation` cannot replace our scroll layer — confirmed, as the issue
suspected.** It is a thin wrapper over `StickToBottom` from
`use-stick-to-bottom`, exposing `scrollToBottom()` and an `isAtBottom` flag.
`client/lib/chat-scroll.ts` (207 lines) implements a `free`/`anchor` phase
machine that pins the user message to the *top* of the viewport with a shrinking
spacer. The library has no top-anchoring concept at all. Adopting it would
regress deliberate behaviour. Scoped out.

**2. `lucide-react` arrives as a second icon library.** This app has no
`lucide-react` and no `@radix-ui/react-icons`. Icons come from
`@/components/ui/icons`, imported by 73 files, on top of `@animateicons/react`.
Every AI Elements component depends on `lucide-react`. Adopting any of them
means shipping two icon libraries, or rewriting every icon import in the
component — which is most of what makes the component worth copying.

**3. The licence does not clear the repository's own rule.** GitHub's API reports
`NOASSERTION` for `vercel/ai-elements` while the `LICENSE` file says Apache-2.0.
The repository requires a permissive licence *verified*, and a detector that
cannot classify the repository is not verification. This must be resolved
upstream before any of that code lands, and it is not something this side can
resolve.

**4. One `add` silently mixes two registries.** A `registryDependencies` entry
without a URL resolves against shadcn's default registry, not the namespace it
came from. `add @ai-elements/reasoning` therefore pulls an upstream
`collapsible` into `ui/` — AI Elements does not publish that item, and their
host returns 404 for it. So an AI Elements install is also an upstream shadcn
install, with whatever that brings.

**5. Copy-in only pays when it removes more than it adds.** The candidates map
onto roughly 1,100 lines we maintain. But the parts that carry our behaviour —
top-anchored scroll, the `MessageSegment` model in `chat-segments.ts`, the
hand-rolled SSE frames, server-side database-backed HITL — are exactly the parts
AI Elements does not model. The components are typed against `UIMessage` from
`ai`; this client never touches `UIMessage`. Each adoption therefore adds an
adapter rather than deleting one.

## The proof of concept

The issue asked for one proof-of-concept component alongside the
recommendation. What it got is stronger evidence in two directions.

Against adoption: `--dry-run` measures the real cost — files, dependencies and
overwrites, against this repository's actual config — without installing
anything and then reverting, which would have left the measurement dependent on
how cleanly the revert went.

For the alternative: **#766 is the proof of concept, already merged.** It took
the `ai-elements` `Reasoning` collapse trigger, implemented it against this
codebase's own segment model, and pinned it with seventeen tests. It cost about
thirty lines, no dependency, no second icon library, no licence question, and
nothing outside `src/client/`. That is the recommended mode, demonstrated in
production rather than in a scratch branch.

## What the patterns are worth

The issue is right that the reference implementations are worth reading, and
#766 already proves the point: it took the `ai-elements` `Reasoning` collapse
trigger — close on reasoning end, not on turn end — and implemented it against
this codebase's own model in about thirty lines, with tests that pin the
behaviour. No dependency, no second icon library, no licence question, no file
outside `src/client/`.

That is the recommended mode for the rest of the list:

| Pattern worth taking | Where it lands |
| --- | --- |
| Per-part reasoning disclosure | done in #766 |
| Token/context usage display (`context`) | nothing exists today; `tokenlens` is the only real dependency, and it is optional |
| Task and chain-of-thought framing for agentic steps | how `ToolRow` groups steps, no new component needed |
| Inline citation affordances | `chat-inline-citations.ts` is 49 lines; the upstream version needs `embla-carousel-react` |

## What would change this verdict

- Upstream resolving the licence detection so `NOASSERTION` becomes Apache-2.0.
- The registry gaining a way to honour the `components` alias over a declared
  `target`, so files land in `src/client/`.
- This app adopting `lucide-react` for unrelated reasons, which would remove the
  second-icon-library cost.

Until at least the first two hold, copying a pattern is cheaper than installing a
component.

## Reproducing

```bash
cd apps/web
pnpm dlx shadcn@latest add @ai-elements/reasoning --dry-run --yes
pnpm dlx shadcn@latest add @ai-elements/tool --dry-run --yes
```

`--dry-run` writes nothing: verified with a clean `git status`, no new directory
under `src/`, and untouched `package.json` and `pnpm-lock.yaml` afterwards.

Read `apps/web/CLAUDE.md` before running any `add` without `--dry-run` — it
documents what the CLI writes into `index.css` and which components it
overwrites.
