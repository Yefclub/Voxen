import assert from "node:assert/strict";
import test from "node:test";
import { parseChangelogFile } from "./release-notes.mjs";

test("parses a bilingual changelog entry with English as canonical content", () => {
  const note = parseChangelogFile(`---
tipo: feat
titulo_en: Search finds related graph concepts
titulo_pt_br: Busca encontra conceitos relacionados do grafo
---
Search now considers verified graph relationships.

<!-- pt-BR -->

A busca agora considera relações verificadas no grafo.
`);

  assert.deepEqual(note, {
    type: "feat",
    title: "Search finds related graph concepts",
    body: "Search now considers verified graph relationships.",
    translations: {
      en: {
        title: "Search finds related graph concepts",
        body: "Search now considers verified graph relationships.",
      },
      "pt-BR": {
        title: "Busca encontra conceitos relacionados do grafo",
        body: "A busca agora considera relações verificadas no grafo.",
      },
    },
  });
});

test("keeps a legacy changelog entry compatible", () => {
  const note = parseChangelogFile(`---
tipo: fix
titulo: Legacy title
---
Legacy body.
`);

  assert.deepEqual(note, {
    type: "fix",
    title: "Legacy title",
    body: "Legacy body.",
  });
});
