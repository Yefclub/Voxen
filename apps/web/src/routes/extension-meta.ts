// ============================================================================
// Metadados da extensão de browser (version check + página de download).
// Servido same-origin para a extensão consultar updates.
// ============================================================================

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const extensionMetaRoutes = new Hono();

function readExtensionVersion(): string {
  try {
    // Prefer manifest empacotado no public/ (deploy) ou source tree.
    const candidates = [
      join(process.cwd(), 'public/extension/unpacked/manifest.json'),
      join(process.cwd(), 'apps/web/public/extension/unpacked/manifest.json'),
      join(process.cwd(), '../extension/manifest.json'),
      join(process.cwd(), 'apps/extension/manifest.json'),
    ];
    for (const p of candidates) {
      try {
        const j = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
        if (j.version) return j.version;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* ignore */
  }
  return '0.2.0';
}

extensionMetaRoutes.get('/version.json', (c) => {
  const origin = new URL(c.req.url).origin;
  const version = readExtensionVersion();
  return c.json({
    version,
    zipUrl: `${origin}/extension/voxen-extension.zip`,
    pageUrl: `${origin}/extensao`,
    notes: 'Melhorias de design, conexão em 1 clique, resumo do job e alertas.',
  });
});
