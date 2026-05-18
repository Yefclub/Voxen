// ============================================================================
// /api/admin/custos — agregações sobre CostEvent (admin only)
// ============================================================================
// GET ?range=month  → totais do mês atual + breakdown por modelo + por user
// GET ?range=all    → all-time totais + breakdown por modelo
// ============================================================================

import { Hono } from 'hono';
import { auth } from '../lib/auth';
import { db } from '../lib/db';

type Vars = { adminUserId: string };

export const costRoutes = new Hono<{ Variables: Vars }>();

costRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Não autenticado.' }, 401);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  if (!user || user.status !== 'APPROVED') {
    return c.json({ error: 'Acesso negado.' }, 403);
  }
  if (user.role !== 'ADMIN') {
    return c.json({ error: 'Acesso restrito a administradores.' }, 403);
  }
  c.set('adminUserId', session.user.id);
  return next();
});

costRoutes.get('/', async (c) => {
  const range = (c.req.query('range') ?? 'month') as 'month' | 'all';

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOf30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  type Row = { total: string | null; events: bigint };
  const [monthAgg] = await db.$queryRaw<Row[]>`
    SELECT
      COALESCE(SUM("costUsd"), 0)::text AS total,
      COUNT(*)::bigint AS events
    FROM "CostEvent"
    WHERE ts >= ${startOfMonth}
  `;
  const [allAgg] = await db.$queryRaw<Row[]>`
    SELECT
      COALESCE(SUM("costUsd"), 0)::text AS total,
      COUNT(*)::bigint AS events
    FROM "CostEvent"
  `;
  const [last30Agg] = await db.$queryRaw<Row[]>`
    SELECT
      COALESCE(SUM("costUsd"), 0)::text AS total,
      COUNT(*)::bigint AS events
    FROM "CostEvent"
    WHERE ts >= ${startOf30d}
  `;

  // Breakdown por modelo (range escolhido)
  type ModelRow = { model: string; total: string; events: bigint; tokens: bigint };
  const since = range === 'month' ? startOfMonth : new Date(0);
  const byModel = await db.$queryRaw<ModelRow[]>`
    SELECT
      model,
      SUM("costUsd")::text AS total,
      COUNT(*)::bigint AS events,
      (COALESCE(SUM("tokensIn"), 0) + COALESCE(SUM("tokensOut"), 0))::bigint AS tokens
    FROM "CostEvent"
    WHERE ts >= ${since}
    GROUP BY model
    ORDER BY SUM("costUsd") DESC
  `;

  // Breakdown por user (range escolhido)
  type UserRow = {
    userId: string;
    email: string | null;
    name: string | null;
    total: string;
    events: bigint;
  };
  const byUser = await db.$queryRaw<UserRow[]>`
    SELECT
      ce."userId" AS "userId",
      u.email,
      u.name,
      SUM(ce."costUsd")::text AS total,
      COUNT(*)::bigint AS events
    FROM "CostEvent" ce
    LEFT JOIN "User" u ON u.id = ce."userId"
    WHERE ce.ts >= ${since}
    GROUP BY ce."userId", u.email, u.name
    ORDER BY SUM(ce."costUsd") DESC
  `;

  // Histórico diário dos últimos 30 dias (pra gráfico simples)
  type DayRow = { day: Date; total: string };
  const daily = await db.$queryRaw<DayRow[]>`
    SELECT
      date_trunc('day', ts) AS day,
      SUM("costUsd")::text AS total
    FROM "CostEvent"
    WHERE ts >= ${startOf30d}
    GROUP BY date_trunc('day', ts)
    ORDER BY day ASC
  `;

  return c.json({
    summary: {
      month: { total: monthAgg?.total ?? '0', events: Number(monthAgg?.events ?? 0n) },
      last30d: { total: last30Agg?.total ?? '0', events: Number(last30Agg?.events ?? 0n) },
      allTime: { total: allAgg?.total ?? '0', events: Number(allAgg?.events ?? 0n) },
    },
    range,
    byModel: byModel.map((m) => ({
      model: m.model,
      total: m.total,
      events: Number(m.events),
      tokens: Number(m.tokens),
    })),
    byUser: byUser.map((u) => ({
      userId: u.userId,
      email: u.email,
      name: u.name,
      total: u.total,
      events: Number(u.events),
    })),
    daily: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      total: d.total,
    })),
  });
});
