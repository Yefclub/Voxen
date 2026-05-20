// ============================================================================
// /grafo — visualização Obsidian-like da KB (transcripts + notes + edges)
// ============================================================================
// Spec: .specs/006-graph-viz.md
// Tech: cytoscape.js layout 'cose' (force-directed builtin).
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import { Network, RotateCw, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { Card, CardContent } from '../components/ui/card';
import { useFetch } from '../lib/hooks';
import { cn } from '../lib/utils';
import { AnimatedPage } from '../components/motion/animated-page';

interface GraphNode {
  id: string;
  label: string;
  type: 'transcript' | 'note' | 'folder';
  source?: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'X' | 'WEB';
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
      <div className="px-8 py-10 mx-auto max-w-7xl space-y-8">
        {/* Header padrão (igual /transcricoes, /jobs, /dashboard) */}
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-app-muted)] font-medium">
            <Network className="h-3.5 w-3.5 text-violet-400" />
            Visualização
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-[-0.03em]">Grafo</h1>
          <p className="text-[15px] text-[var(--color-app-muted)] leading-relaxed max-w-2xl">
            Mapa visual de toda sua biblioteca. Transcrições e notas conectadas por wiki-links
            <code className="text-zinc-300 mx-1">[[título]]</code> e por hierarquia de pastas.
            Clique num nó pra abrir.
          </p>
        </header>

        {/* Controles em barra acima do canvas */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-zinc-400">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar nós e vizinhos…"
              className="relative w-full h-11 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface)]/70 backdrop-blur-sm pl-10 pr-4 text-[14px] text-zinc-100 placeholder:text-[var(--color-app-muted)] focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15 transition-colors"
            />
          </div>
          <Button variant="outline" size="default" onClick={refresh} disabled={loading}>
            <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </Button>
          {stats && stats.nodes.length > 0 && (
            <div className="ml-auto inline-flex items-center gap-3 text-[11px] tabular-nums text-[var(--color-app-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-400" />
                {stats.nodes.filter((n) => n.type === 'transcript').length} transcrições
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {stats.nodes.filter((n) => n.type === 'note').length} notas
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-amber-400" />
                {stats.nodes.filter((n) => n.type === 'folder').length} pastas
              </span>
              <span className="text-[var(--color-app-muted)]/60">
                · {stats.edges.length} conexões
              </span>
            </div>
          )}
        </div>

        {/* Canvas — Card elevated com altura fixa (consistente com /transcricoes/:id detail) */}
        <Card elevated className="overflow-hidden p-0 relative">
          <div className="relative h-[calc(100vh-360px)] min-h-[500px]">
            {loading && !data && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </div>
            )}
            {!loading && data && data.nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <CardContent className="py-12 text-center space-y-3 max-w-md">
                  <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-emerald-500/20 border border-[var(--color-app-border-strong)] flex items-center justify-center">
                    <Network className="h-5 w-5 text-violet-400" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-display text-lg font-semibold tracking-tight">
                      Biblioteca vazia
                    </p>
                    <p className="text-sm text-[var(--color-app-muted)] leading-relaxed">
                      Crie uma nota em <code className="text-zinc-300">/notas</code> ou transcreva
                      conteúdo em <code className="text-zinc-300">/jobs</code> pra começar.
                    </p>
                  </div>
                </CardContent>
              </div>
            )}
            <div ref={containerRef} className="absolute inset-0" />
          </div>
        </Card>
      </div>
    </AnimatedPage>
  );
}
