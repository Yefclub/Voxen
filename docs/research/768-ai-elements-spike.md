# Spike 768 — Vercel AI Elements for the chat interface

**Verdict: take the patterns, not the components. Do not adopt AI Elements.**

Deliverable of issue #768. Numbers below were produced by running the tool
against this repository or by reading the source. Where prior work established a
finding, it is credited rather than restated as new.

## The question the issue asked first

> Does installing AI Elements in a Vite app without `components.json` work at
> all, without disturbing the existing `components/ui/` tree?

**It works.** PR #780 added a hand-written `components.json`, and the CLI
resolves the `@ai-elements` namespace without `shadcn init` ever running.

**It disturbs the tree anyway.** The registry items declare their own `target`,
which overrides both the `components` alias and the `-p` flag, so files land in
`src/components/ai-elements/` rather than under `src/client/`. That behaviour,
the 404 that makes one `add` mix two registries, and the second icon library are
documented in `apps/web/CLAUDE.md` — they were found while wiring the CLI in
#770, not by this spike, and they are summarised here because they bear on the
decision.

## Proof of concept: `sources`, installed

`sources` is the cheapest candidate — 2 files, no overwrites, and no coupling to
`ai` at all — so it is the fairest test of the adopt case. It was installed for
real on a throwaway branch and then reverted.

```
✔ Created 2 files:
  - src/client/components/ui/collapsible.tsx
  - src/components/ai-elements/sources.tsx
```

What arrived: **77 lines**, four exports (`Sources`, `SourcesTrigger`,
`SourcesContent`, `Source`), and one shadcn token to restyle (`text-primary`).

What it does, in full:

```tsx
export const Source = ({ href, title, children, ...props }: SourceProps) => (
  <a className="flex items-center gap-2" href={href} rel="noreferrer" target="_blank" {...props}>
    {children ?? (<><BookIcon className="h-4 w-4" /><span className="block font-medium">{title}</span></>)}
  </a>
);
```

A collapsible list of links that open in a new tab.

`chat-sources-panel.tsx` is 318 lines and does something else. `CitationCanvas`
(lines 109-221, 112 lines) renders the cited content **inside the app**, with
back and close affordances and a mobile variant. `ChatSourcesPanel` (96 lines)
hosts it.

So the honest comparison is not 77 against 318. Upstream `sources` could replace
roughly the trigger-and-list portion — call it 70 of our lines — while the 112
lines that make it a reader rather than a link list have no upstream
counterpart. **Removing ~70 lines in exchange for a new dependency surface, a
file outside `src/client/`, and a restyle pass is not a trade worth making.**

Two dependencies were actually added by that install, and both are new to this
repository:

```
+ "lucide-react": "^1.31.0"
+ "radix-ui": "^1.6.7"
```

`radix-ui` is the unified package. This app uses eleven individual
`@radix-ui/react-*` packages and does not have it. Every AI Elements component
pulls it, so adopting any of them means carrying two Radix distributions.

## Measured cost per candidate

Each row is `shadcn add @ai-elements/<name> --dry-run` against this repository.
"New deps" counts only packages absent from `apps/web/package.json`; the CLI's
own totals are higher because they include ones already present.

| Component | Files | New deps | Overwrites |
| --- | --- | --- | --- |
| `task` | 2 | 2 | — |
| `sources` | 2 | 2 | — |
| `context` | 4 | 3 | `button` |
| `reasoning` | 3 | 7 | — |
| `confirmation` | 3 | 2 | `alert`, `button` |
| `chain-of-thought` | 3 | 3 | `badge` |
| `inline-citation` | 5 | 3 | `badge`, `button` |
| `tool` | 6 | 3 | `badge`, `button`, `select` |

The overwrites are the sharp edge: `button`, `badge`, `select` and `alert`
already went through the manual pass onto `--color-app-*`. The CLI prompts per
file, so nothing is lost silently — but adopting means either declining and
hand-merging, or accepting and redoing the restyle.

`reasoning` pulling seven new packages for one collapsible block is the other
outlier; four are `@streamdown/*` plugins for CJK, code, math and mermaid that
this chat does not render.

## What decides it

**1. `Conversation` cannot replace the scroll layer.** It wraps
`use-stick-to-bottom`, exposing `scrollToBottom()` and `isAtBottom`.
`client/lib/chat-scroll.ts` (207 lines) pins the user message to the *top* of the
viewport through a `free`/`anchor` phase machine with a shrinking spacer and
proximity-based re-engagement. The library does expose a `targetScrollTop`
option, so top positioning is not strictly unreachable — but the phase machine,
the spacer and the re-engagement rule are ours either way, and that is the whole
of the behaviour. Scoped out, as the issue expected.

**2. The candidates do not model what our components do.** This is the real
version of the coupling concern the issue raised. The issue asked whether the
components are typed against `UIMessage`; measured, only `conversation` imports
it, and that one is already out. `tool` and `confirmation` import `ToolUIPart`,
`context` imports `LanguageModelUsage`, and `sources`, `reasoning` and
`inline-citation` import nothing from `ai`. So type coupling is **not** the
obstacle. The obstacle is scope: the PoC above shows `sources` is a link list
where ours is a reader, and the same gap holds elsewhere — our HITL bar is bound
to a server-side, database-backed approval flow that `confirmation` does not
model.

**3. Two Radix distributions and two icon libraries.** Beyond `radix-ui`, every
component depends on `lucide-react`. This app has none: icons come from
`@/components/ui/icons`, imported by 75 files, on top of `@animateicons/react`.
Rewriting those imports is most of what makes copying a component worth it.

**4. The licence question the issue asked is still unanswered — but it is
smaller than it looks.** GitHub reports `NOASSERTION` for `vercel/ai-elements`.
That is explained by the `LICENSE` file being the twelve-line Apache-2.0 notice
rather than the full text, which licence detectors do not classify; it is not
evidence of a licensing problem. The issue's actual question was which licence
applies to the **registry output**, and the registry JSON carries no licence
field at all (`$schema`, `dependencies`, `description`, `devDependencies`,
`files`, `name`, `registryDependencies`, `title`, `type`). Worth one upstream
question before adopting, not a blocker on its own.

## What the patterns are worth

The reference implementations are worth reading. PR #776 is the demonstration:
it took the `ai-elements` `Reasoning` collapse trigger — close on reasoning end,
not on turn end — and implemented it against this codebase's own segment model.

Its real cost, since this document's earlier draft understated it: **+57/-13
lines of implementation** across `thinking-disclosure.ts` and `chat.tsx`, plus a
114-line spec and +136/-10 of tests — 307 insertions in total. Not thirty lines.
But no dependency, no second Radix distribution, no second icon library, no
licence question, and nothing outside `src/client/`.

That is a fair comparison only because it is a fair number: porting a pattern is
cheaper than installing a component *here*, not free.

| Pattern worth taking | Where it lands |
| --- | --- |
| Per-part reasoning disclosure | done, PR #776 |
| Token and context usage display | nothing exists today; `context` needs `tokenlens`, `radix-ui` and `lucide-react`, and overwrites `button` |
| Task and chain-of-thought framing for agentic steps | how `ToolRow` groups steps; no new component needed |
| Inline citation affordances | `chat-inline-citations.ts` is 49 lines; upstream also needs `embla-carousel-react` |

## What would change this verdict

- A candidate appearing whose scope actually matches ours — the `sources`
  measurement is the test to repeat, not the conclusion to assume.
- This app adopting `lucide-react` and the unified `radix-ui` for unrelated
  reasons, which removes the duplicate-surface cost.
- An upstream answer on the registry output's licence.

The `target` placement is deliberately **not** on this list: a copy-in component
lives in our tree, so `git mv` after install settles it.

## Reproducing

```bash
cd apps/web
pnpm dlx shadcn@latest add @ai-elements/sources --dry-run --yes
pnpm dlx shadcn@latest add @ai-elements/tool --dry-run --yes
```

`--dry-run` writes nothing: verified with a clean `git status`, no new directory
under `src/`, and untouched `package.json` and `pnpm-lock.yaml`. The `sources`
install above was done without it, on a throwaway branch, and reverted — the two
created files removed and both manifests restored.

Read `apps/web/CLAUDE.md` before any `add` without `--dry-run`: it documents what
the CLI writes into `index.css` and which components it overwrites.
