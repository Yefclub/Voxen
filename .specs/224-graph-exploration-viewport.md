# Spec 224 — Legible graph exploration and reliable viewports

## Context

The owner requested browser inspection and improvements to both graph modes,
explicitly reporting that 3D starts enlarged and clipped. The owner confirmed
that finding and opening related content is the primary task.

Browser inspection of deployed revision `57855e22` with 500 nodes and 1,500
edges reproduced the clipped 3D view, visually dominant edges, nearly absent
overview labels and an inspector covering the map and its controls. The 3D
view automatically refocuses the largest community after an initial fit and
limits camera distance below what the full graph requires.

The existing Voxen themes, source data and graph capabilities remain the
product constraints. Relevant interaction references are the
[Obsidian graph view](https://obsidian.md/help/plugins/graph) and
[Sigma examples](https://www.sigmajs.org/examples/): overview, search,
neighborhood highlighting and progressive details.

## Requirements

### Ubiquitous

- The system shall retain every node and edge in the selected graph slice,
  existing search scope, evidence, type filters and source navigation.
- The system shall distinguish node categories and the selected neighborhood
  in all four existing themes without making overview edges dominate nodes.
- The system shall expose labeled zoom, fit and selection-focus actions in
  consistent positions in 2D and 3D.

### Event-driven

- When 3D becomes ready or its topology changes, the system shall fit all
  rendered nodes inside the available canvas without a subsequent automatic
  zoom to the largest community.
- When graph initialization is delayed, the system shall wait for usable
  geometry and camera controls within the existing initialization budget.
- When the user selects a node, the system shall show its full title and
  available related content without covering desktop viewport controls.
- When a related node is selected, the system shall update the details and
  highlight its neighborhood; an explicit action shall open its source when
  that node has a navigable source.
- When the user changes between 2D and 3D, the system shall retain the current
  search, type filters and selected node.

### State-driven

- While the graph is dense, the system shall keep overview connections quiet,
  expose readable representative labels where space permits and make full
  node titles available in search and details.
- While the camera is zoomed out to fit the graph, the system shall keep all
  rendered node markers visible rather than hiding distant nodes with fog.
- While the screen cannot accommodate a side panel, the system shall provide
  dismissible exploration/details with accessible close controls, place selected
  details below the map and keep zoom and fit actions reachable.
- While the graph topology is unchanged, the system shall preserve user camera
  navigation across hover, selection and theme updates.

### Unwanted behavior

- If 3D cannot initialize or loses its WebGL context, then the system shall
  preserve the existing 2D fallback and stop outstanding initialization work.
- If filters leave no visible nodes, then the system shall explain the empty
  result and provide a reset action.

## Acceptance criteria

- [x] Browser evidence reproduces the original 2D and 3D issues.
- [x] Initial and explicit full fits include all 3D nodes on desktop and phone;
      delayed readiness does not cause an early or subsequent primary-only fit.
- [x] Zoom, full fit, selection focus, type filters, search, related-node
      selection, source opening, mode changes and panel dismissal work.
- [x] Desktop details do not cover the map; phone layouts have no horizontal
      overflow and keep camera controls reachable.
- [ ] Empty results, all themes, reduced motion and WebGL fallback retain their
      observable contracts.
- [ ] Regressions, required checks, independent review and CI pass; deployed
      revision receives a final browser check.

## Out of scope

Graph recompilation, changes to relationships/evidence, new renderers or
dependencies, provider settings, global navigation redesign and a new brand.

> 2026-11-12: Scope authorized by the owner's request to inspect and improve
> both graph modes; related-content navigation was confirmed as the priority.
