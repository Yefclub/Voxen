# MCP client configuration contrast

## Problem

The selected client configuration on `/conta/mcp` can render as a bright, low-contrast block inside a dark application theme. The panel then looks detached from the page and its foreground tokens become difficult to read.

## Decision

- Use a neutral translucent overlay for the selected configuration instead of reusing the page background token.
- Keep semantic foreground, border, and input tokens so all supported themes retain their contrast.
- Keep client tabs on one horizontally scrollable row at narrow widths instead of producing an irregular wrapped toolbar.
- Preserve the existing copy, credential, scope, and user-isolation behavior.

## Acceptance criteria

- The configuration surface remains visually subordinate to its parent card in dark and light themes.
- Labels, status, explanation, code, and copy action remain readable.
- Client selection remains usable on narrow screens.
- Existing MCP setup tests and the complete web suite pass.
