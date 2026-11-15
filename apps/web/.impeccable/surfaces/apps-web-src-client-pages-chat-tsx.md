---
version: 1
slug: 'apps-web-src-client-pages-chat-tsx'
primary_target: 'apps/web/src/client/pages/chat.tsx'
related_targets:
  ['apps/web/src/client/components/assistant', 'apps/web/src/client/lib/use-assistant.ts']
---

## Scope

Operate and Read. Extend the established Voxen workspace with one continuous,
source-grounded conversation. Use the owner-requested flat desktop shell, preserving typography, Light/Dark
appearances, mobile portrait boundary and shared controls.

## Direction contract

THESIS: A readable ongoing exchange with the library, with sources and completed
actions beside the answer. Conversation, rather than a session picker, owns the page.
OWN-WORLD: Inherit the documentary workspace, emerald interaction, Inter prose,
Bricolage headings, thin rules and the shared Astryx Button wrapper.
STORY: Ask about saved content, follow real sources, request additions or confirm an exact proposal,
and edit a prior question without losing published knowledge.
FIRST VIEWPORT: Navigation supplies the destination title; the page heading remains accessible without repeating it visually. Preferences sit inside the composer beside the send control, preserving the writing space. A restrained empty-state question leads into a compact single-row composer that grows with the draft; during conversation the same composer docks below the transcript.
The phone keeps the input above the keyboard; preferences and editing use sheets.
Use the installed native Astryx ChatComposer/Input, ChatMessage/List/Bubble,
and stream-scroll hooks. Progress uses one native details disclosure with localized received tool activity; it never invents successful steps. Keep the same input mounted when the first
message arrives. Use a simple upward send arrow and no permission-mode selector. The owner prefers Meta where an equivalent exists, otherwise
Vercel AI Elements. Streaming and tools use Vercel AI SDK.
FORM: Continuous reading surface extending the existing documentary contact sheet;
existing direction reference seed:386810c868ac3e64. No new visual identity or assets.
REFERENCE: The owner confirmed a Grok-informed conversation/composer refinement on 2026-11-15 while retaining Voxen navigation. Public grok.com was inspected at 1280×800 and 390×844: a 764px desktop writing measure, 58px empty capsule, 28px invitation, tonal user message and quiet task rows. Draft expansion was observed; authenticated assistant output was unavailable. Adapt the composition through Voxen tokens and 44px touch targets, without copying branding, proprietary fonts or product claims. Orbital's prior compact expandable activity remains retained behavior.
REFINEMENT: Keep the same Astryx editor mounted. Match Grok's observed inline-to-stacked transition on wrap/newline, retaining expansion until empty, with a six-line/visual-viewport cap. ChatGPT's anonymous response was inspected in desktop and phone views: 768px reading/input measure, 16px/26px prose, 24px lead heading and 20px section headings, quiet copy actions, open answers and right-aligned user bubbles. Align assistant prose to the input's left boundary and user bubbles to its right boundary within 2px, including scrollbar space. Reduce the invitation's display weight and align quiet task rows with the input. Copy feedback preserves the draft. No replacement world or new assets; the existing seed reference remains inherited.
INTERACTIONS (spec 232): Stage file selection/drop/paste in the native composer's drawer before upload, with a removable named/sized preview and local image thumbnail. Preserve failed drafts and reuse a completed upload on message retry. Sources occupy a nonmodal right panel at desktop reading widths and the existing mobile sheet below 1024px; both retain the editor, source links and focus restoration. The 44px return-to-latest arrow floats over the transcript with transparent surroundings and does not increase the dock's height. Follow the latest response when the composer/viewport resizes only while scroll following remains locked.
MOTION: One restrained live-activity rotation marks ongoing work; reduced motion keeps the indicator static. Streamed Markdown remains readable as it arrives without replaying paragraph entrances. The desktop shell uses the shadcn controlled Sidebar/Header/Content/Footer/Inset composition adapted to Voxen tokens and its existing persisted state: sidebar width and workspace offset share an interruptible 200ms easing, with no spatial transition under reduced motion. Mobile navigation stays independent.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
