// ============================================================================
// /grafo — visualização Obsidian-like da KB (transcripts + notes + edges)
// ============================================================================
// Spec: .specs/006-graph-viz.md
// Tech: cytoscape.js layout 'cose' (force-directed builtin).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import { motion } from 'motion/react';
import { Network, RotateCw, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { Card, CardContent } from '../components/ui/card';
import { useFetch } from '../lib/hooks';
import { AnimatedPage } from '../components/motion/animated-page';

interface GraphNode {
  id: string;
  label: string;
  type: 'transcript' | 'note' | 'folder';
  source?: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'WEB';
  weight: number;
}
interface GraphEdge {
  from: string;
  to: string;
  kind: 'wikilink' | 'parent';
}
interface GraphResp {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  totalEdges: number;
}

const COLORS = {
  transcript: 'oklch(72% 0.18 290)', // violet
  note: 'oklch(73% 0.16 159)', // emerald
  folder: 'oklch(80% 0.16 78)', // amber
};

export function GrafoPage(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const { data, loading, refresh } = useFetch<GraphResp>('/api/graph');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!search.trim()) return data;
    const needle = search.trim().toLowerCase();
    const matchedIds = new Set(
      data.nodes.filter((n) => n.label.toLowerCase().includes(needle)).map((n) => n.id),
    );
    // Inclui vizinhos imediatos dos matched
    for (const e of data.edges) {
      if (matchedIds.has(e.from)) matchedIds.add(e.to);
      if (matchedIds.has(e.to)) matchedIds.add(e.from);
    }
    return {
      ...data,
      nodes: data.nodes.filter((n) => matchedIds.has(n.id)),
      edges: data.edges.filter((e) => matchedIds.has(e.from) && matchedIds.has(e.to)),
    };
  }, [data, search]);

  useEffect(() => {
    if (!containerRef.current || !filtered) return;
    // Destroi instância anterior pra evitar memory leak em re-render
    cyRef.current?.destroy();
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...filtered.nodes.map((n) => ({
          data: { id: n.id, label: n.label, type: n.type },
          classes: n.type,
        })),
        ...filtered.edges.map((e, i) => ({
          data: { id: `e${i}`, source: e.from, target: e.to, kind: e.kind },
          classes: e.kind,
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#e4e4e7',
            'font-size': 9,
            'font-family': 'Inter, sans-serif',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-max-width': '120px',
            'text-wrap': 'wrap',
            width: 12,
            height: 12,
            'border-width': 1,
            'border-color': '#27272a',
          },
        },
        {
          selector: 'node.transcript',
          style: { 'background-color': COLORS.transcript, width: 14, height: 14 },
        },
        { selector: 'node.note', style: { 'background-color': COLORS.note } },
        {
          selector: 'node.folder',
          style: { 'background-color': COLORS.folder, width: 18, height: 18, shape: 'rectangle' },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#3f3f46',
            'curve-style': 'bezier',
            opacity: 0.6,
          },
        },
        {
          selector: 'edge.wikilink',
          style: { 'line-color': 'oklch(72% 0.18 290 / 0.7)', width: 1.5 },
        },
        { selector: 'edge.parent', style: { 'line-color': '#52525b', 'line-style': 'dashed' } },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#fafafa' },
        },
      ],
      layout: {
        name: 'cose',
        animate: true,
        animationDuration: 600,
        nodeRepulsion: () => 4500,
        idealEdgeLength: () => 70,
        edgeElasticity: () => 50,
        gravity: 0.4,
        randomize: false,
      },
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 3,
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target as NodeSingular;
      const id = node.id();
      if (id.startsWith('t:')) {
        navigate(`/transcricoes/${id.slice(2)}`);
      } else if (id.startsWith('n:')) {
        navigate(`/notas/${id.slice(2)}`);
      }
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
    };
  }, [filtered, navigate]);

  const stats = filtered ?? data;

  return (
    <AnimatedPage>
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between px-8 py-5 border-b border-[var(--color-app-border)] gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
              <Network className="h-3.5 w-3.5 text-violet-400" />
              Grafo da biblioteca
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Mapa visual</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-app-muted)] pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar nós…"
                className="h-9 w-56 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/60 pl-9 pr-3 text-[13px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RotateCw className="h-3.5 w-3.5" />
              Atualizar
            </Button>
          </div>
        </header>

        <div className="flex-1 min-h-0 relative">
          {loading && !data && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner />
            </div>
          )}
          {!loading && data && data.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Card>
                <CardContent className="py-10 px-8 text-center space-y-2">
                  <Network className="mx-auto h-8 w-8 text-violet-400" />
                  <p className="font-display text-lg font-semibold">Biblioteca vazia</p>
                  <p className="text-sm text-[var(--color-app-muted)]">
                    Crie uma nota ou transcreva um conteúdo pra começar a ver o grafo.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
          <div ref={containerRef} className="absolute inset-0" />

          {stats && stats.nodes.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute bottom-4 left-4 rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg-elevated)]/85 backdrop-blur-sm px-3.5 py-2.5 text-[11px] space-y-1"
            >
              <div className="flex items-center gap-2 text-[var(--color-app-muted)]">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                <span>Transcrição</span>
              </div>
              <div className="flex items-center gap-2 text-[var(--color-app-muted)]">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Nota</span>
              </div>
              <div className="flex items-center gap-2 text-[var(--color-app-muted)]">
                <span className="h-2 w-2 rounded-sm bg-amber-400" />
                <span>Pasta</span>
              </div>
              <div className="pt-1 text-[10px] tabular-nums text-[var(--color-app-muted)] border-t border-[var(--color-app-border)]">
                {stats.nodes.length} nós · {stats.edges.length} conexões
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </AnimatedPage>
  );
}
