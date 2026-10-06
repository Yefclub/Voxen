import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/server';
import {
  expandContextFromMd,
  findRelated,
  loadTranscriptMd,
  parseOutline,
  readLinesFromMd,
  readSectionFromMd,
  readTimespanFromMd,
  verifyClaimAgainstMd,
} from '../lib/retrieval';
import { fail, ok, READ_ONLY } from './mcp-tool-helpers';

export function registerProgressiveTools(server: McpServer, userId: string): void {
  server.registerTool(
    'voxen_outline',
    {
      title: 'Estrutura da transcrição',
      description:
        'PASSO 2 do fluxo: lista a ESTRUTURA do `.md` de uma transcrição — seções (headings) ' +
        'com heading, timestamp inicial (hh:mm:ss + seg), linha inicial e nº de linhas, mais o ' +
        'total de linhas. Use após buscar e antes de abrir conteúdo, para mirar o trecho certo. ' +
        'Sem texto pesado.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
      },
      annotations: { ...READ_ONLY, title: 'Estrutura da transcrição' },
    },
    async (args) => {
      const doc = await loadTranscriptMd(userId, args.transcript_id.trim());
      if (!doc) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      const outline = parseOutline(doc.md);
      return ok({ id: doc.id, title: doc.title, ...outline });
    },
  );

  server.registerTool(
    'voxen_read_lines',
    {
      title: 'Ler linhas',
      description:
        'PASSO 3: lê um intervalo de linhas [from, to] (1-indexed, inclusivo, cap de 200 linhas) ' +
        'do `.md`. Prefira isto a ler o documento inteiro.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        from: z.number().int().min(1).describe('Primeira linha (1-indexed).'),
        to: z.number().int().min(1).describe('Última linha (inclusiva).'),
      },
      annotations: { ...READ_ONLY, title: 'Ler linhas' },
    },
    async (args) => {
      const doc = await loadTranscriptMd(userId, args.transcript_id.trim());
      if (!doc) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      return ok({ id: doc.id, title: doc.title, ...readLinesFromMd(doc.md, args.from, args.to) });
    },
  );

  server.registerTool(
    'voxen_read_section',
    {
      title: 'Ler seção',
      description:
        'PASSO 3: lê as linhas de uma seção do outline, por `heading` (match parcial, ' +
        'case-insensitive) OU por `index` (posição no outline de voxen_outline).',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        heading: z.string().min(1).optional().describe('Heading da seção (match parcial).'),
        index: z.number().int().min(0).optional().describe('Índice da seção no outline.'),
      },
      annotations: { ...READ_ONLY, title: 'Ler seção' },
    },
    async (args) => {
      if (args.heading === undefined && args.index === undefined) {
        return fail('Informe heading ou index.');
      }
      const doc = await loadTranscriptMd(userId, args.transcript_id.trim());
      if (!doc) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      const result = readSectionFromMd(doc.md, { heading: args.heading, index: args.index });
      if (!result) return fail('Seção não encontrada.');
      return ok({ id: doc.id, title: doc.title, ...result });
    },
  );

  server.registerTool(
    'voxen_read_timespan',
    {
      title: 'Ler intervalo de tempo',
      description:
        'PASSO 3: lê as linhas cujo timestamp cai em [from_sec, to_sec] (segundos, inclusivo, ' +
        'cap de 200 linhas). Útil para ancorar num momento do vídeo.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        from_sec: z.number().int().min(0).describe('Início em segundos.'),
        to_sec: z.number().int().min(0).describe('Fim em segundos (inclusivo).'),
      },
      annotations: { ...READ_ONLY, title: 'Ler intervalo de tempo' },
    },
    async (args) => {
      const doc = await loadTranscriptMd(userId, args.transcript_id.trim());
      if (!doc) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      return ok({
        id: doc.id,
        title: doc.title,
        ...readTimespanFromMd(doc.md, args.from_sec, args.to_sec),
      });
    },
  );

  server.registerTool(
    'voxen_expand_context',
    {
      title: 'Expandir contexto',
      description:
        'PASSO 4: dada uma âncora (`line` OU `sec`), devolve uma janela de `radius` linhas ' +
        'antes/depois. Use só quando o trecho lido não bastar.',
      inputSchema: {
        transcript_id: z.string().min(1).describe('ID da transcrição.'),
        line: z.number().int().min(1).optional().describe('Linha-âncora (1-indexed).'),
        sec: z.number().int().min(0).optional().describe('Timestamp-âncora em segundos.'),
        radius: z
          .number()
          .int()
          .min(0)
          .max(200)
          .optional()
          .describe('Linhas antes/depois (padrão 8).'),
      },
      annotations: { ...READ_ONLY, title: 'Expandir contexto' },
    },
    async (args) => {
      if (args.line === undefined && args.sec === undefined) {
        return fail('Informe line ou sec.');
      }
      const doc = await loadTranscriptMd(userId, args.transcript_id.trim());
      if (!doc) return fail('Transcrição não encontrada (ou fora do escopo do token).');
      const result = expandContextFromMd(doc.md, { line: args.line, sec: args.sec }, args.radius);
      if (!result) return fail('Âncora não encontrada.');
      return ok({ id: doc.id, title: doc.title, ...result });
    },
  );

  server.registerTool(
    'voxen_related',
    {
      title: 'Documentos relacionados',
      description:
        'PASSO 6: dado um `transcript_id` E/OU uma `query`, retorna transcrições/notas ' +
        'relacionadas via Brain (vizinhança no grafo) + FTS por título/tópico. Retorna ' +
        'id, título, tipo e motivo.',
      inputSchema: {
        transcript_id: z.string().min(1).optional().describe('ID da transcrição de origem.'),
        query: z
          .string()
          .min(1)
          .max(300)
          .optional()
          .describe('Termos de busca (alternativa/complemento).'),
        limit: z.number().int().min(1).max(25).optional().describe('Máx. itens (padrão 10).'),
      },
      annotations: { ...READ_ONLY, title: 'Documentos relacionados' },
    },
    async (args) => {
      if (!args.transcript_id && !args.query) return fail('Informe transcript_id ou query.');
      const results = await findRelated(userId, {
        transcriptId: args.transcript_id,
        query: args.query,
        limit: args.limit,
      });
      return ok({ results });
    },
  );

  server.registerTool(
    'voxen_verify_citations',
    {
      title: 'Verificar citações',
      description:
        'PASSO 9: verifica DETERMINISTICAMENTE (sem LLM) se cada citação existe no trecho ' +
        'indicado do `.md`. Para cada claim, re-lê o trecho (por linhas, por tempo, ou o ' +
        'documento inteiro) e checa se a `quote` está presente (comparação normalizada). Use ' +
        'antes de afirmar fatos fortes.',
      inputSchema: {
        claims: z
          .array(
            z.object({
              transcript_id: z.string().min(1),
              quote: z.string().min(1).max(2000),
              from_line: z.number().int().min(1).optional(),
              to_line: z.number().int().min(1).optional(),
              from_sec: z.number().int().min(0).optional(),
              to_sec: z.number().int().min(0).optional(),
            }),
          )
          .min(1)
          .max(20)
          .describe('Lista de citações a verificar.'),
      },
      annotations: { ...READ_ONLY, title: 'Verificar citações' },
    },
    async (args) => {
      const cache = new Map<string, string | null>();
      const results = [];
      for (const claim of args.claims) {
        const tid = claim.transcript_id.trim();
        let md = cache.get(tid);
        if (md === undefined) {
          const doc = await loadTranscriptMd(userId, tid);
          md = doc?.md ?? null;
          cache.set(tid, md);
        }
        if (md === null) {
          results.push({
            transcriptId: tid,
            supported: false,
            error: 'Transcrição não encontrada.',
          });
          continue;
        }
        const verdict = verifyClaimAgainstMd(md, {
          quote: claim.quote,
          fromLine: claim.from_line,
          toLine: claim.to_line,
          fromSec: claim.from_sec,
          toSec: claim.to_sec,
        });
        results.push({ transcriptId: tid, ...verdict });
      }
      return ok({ results });
    },
  );
}
