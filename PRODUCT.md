# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individuals and small teams running their own knowledge library. The owner uses
the installed mobile PWA to share links into Voxen, then reads the analyzed
content and finds related material. Administrators control deployment, access,
provider configuration and integrations.

## Product Purpose

Turn captured or externally published material into a searchable, readable
knowledge library. Primary workflows are capture/share, reading, deterministic
search, related-content exploration and notes. External MCP clients publish and
retrieve content through versioned contracts.

## Positioning

Voxen is self-hosted and single-tenant. It is not a paid multi-tenant SaaS.
The knowledge base remains usable without an AI provider; optional capture uses
configured providers to interpret submitted content. Retrieval does not depend
on embeddings.

## Operating Context

Desktop browsers and an installed mobile PWA. Shared links and files enter a
capture workflow; completed foreground captures lead to their document.
Documents, notes and a 2D/3D knowledge graph support revisiting related content.
Authentication includes approval, optional SSO, QR login and MCP OAuth flows.

## Capabilities and Constraints

Preserve existing data, ownership boundaries, public HTTP/MCP contracts and
working product capabilities. Never expose credentials or private library
content on public authentication screens. Essential mobile workflows must work
without relying on experimental browser APIs or gestures alone.

The owner authorized a complete frontend reconstruction and delivery to dev
with deployment. The owner confirmed consolidating four appearance packs into
Light/Dark modes with one Voxen identity; existing preferences need migration.
PT-BR and English remain supported.

## Brand Commitments

Keep the Voxen name. The owner replaced the owl with a minimal, transparent,
emerald symbol based on connected folded forms (spec 226). The owner explicitly named
Meta Astryx and GoogleChrome Modern Web Guidance as required design/platform
references. The new frontend must be cohesive, content-focused and adapted to
mobile PWA use, including login, account and administration screens.
The owner explicitly prefers mobile sheets for contextual tasks instead of
shrinking desktop modals onto a phone.

The desktop shell uses the same identity with distinct navigation and content
surfaces. The approved mobile navigation stays in place. Phone use is portrait;
platform orientation restrictions use an honest in-app fallback when necessary.

## Evidence on Hand

The owner's capture-page screenshot and authenticated browser inspection show
misaligned page widths, obstructed mobile headings, stale navigation labels and
overly prominent processing metadata. The repository contains the actual
product routes, capture contracts, existing logo and regression suites.
Use isolated data for destructive or credential-changing validation.

## Product Principles

- Capture should lead to useful content, with clear progress and recovery.
- Reading and finding related material take priority over processing internals.
- Navigation and page structure must stay predictable across all screens.
- Mobile is a primary usage context, including installed and shared-entry flows.
- A frontend reconstruction must preserve the integrity of the knowledge base.

## Accessibility & Inclusion

Provide usable keyboard and touch controls, visible focus, semantic headings,
readable contrast, actionable announced errors and reduced-motion support.
Honor safe areas and changing viewport/keyboard dimensions. Real-device-only
checks must be distinguished from browser emulation.
