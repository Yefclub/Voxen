// ============================================================================
// tunnel-proxy — proxy de WebSocket da web do Voxen pro chisel server local.
// ============================================================================
// Em vez de exigir um subdomínio `tunnel.<host>` separado, o agente residencial
// conecta no PRÓPRIO Voxen: wss://<url-do-voxen>/_tunnel. A web aceita o upgrade
// de WebSocket nesse path e faz um pipe bidirecional com o chisel server, que
// roda local na imagem combinada em ws://127.0.0.1:${CHISEL_PORT:-8088}.
//
// Por que isso funciona com o chisel (confirmado no source jpillora/chisel):
//   - O chisel server NÃO roteia o upgrade por PATH. O que dispara o túnel é o
//     header `Sec-WebSocket-Protocol: chisel-v3` + `Upgrade: websocket`. O path
//     é cosmético — então `/_tunnel` no Voxen → `/` no chisel funciona.
//   - O transporte é WebSocket binário puro (SSH por cima); um pipe frame-a-frame
//     não quebra nada. Não há framing custom.
//   - O subprotocolo `chisel-v3` é OBRIGATÓRIO: precisamos abrir o socket upstream
//     pedindo esse subprotocolo e ecoar de volta pro agente, senão o chisel
//     server ignora a conexão ("ignored client connection using protocol ...").
//
// Segurança:
//   - O path SÓ repassa pro chisel local (127.0.0.1:CHISEL_PORT). NUNCA expõe
//     outra coisa. O gate de auth real é o token do chisel (authfile), não este
//     path — qualquer um pode bater no path, mas sem o token o chisel recusa.
//   - NÃO logamos tráfego (são bytes SSH cifrados + o token vai no header de auth
//     que NÃO inspecionamos). Logs só de ciclo de vida, sem conteúdo.
// ============================================================================

import type { Server, ServerWebSocket } from 'bun';
import { proxyTunnelPath } from './proxy-agent-tunnel';

// Subprotocolo que o chisel exige no handshake (share/settings: "chisel-v3").
const CHISEL_PROTOCOL = 'chisel-v3';

function chiselPort(): number {
  const raw = process.env.CHISEL_PORT?.trim();
  const n = raw ? Number(raw) : 8088;
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8088;
}

// Estado por socket do agente (lado downstream). Guardamos o WS client upstream
// (pro chisel) e uma fila de frames que chegaram antes do upstream abrir.
type TunnelData = {
  upstream: WebSocket | null;
  pending: Array<string | ArrayBufferLike | Uint8Array>;
  closing: boolean;
};

/**
 * Tenta fazer upgrade de WebSocket pro túnel. Contrato de retorno:
 *   - `null`      → request NÃO é deste path; o caller deve seguir pro Hono.
 *   - `undefined` → upgrade aceito; o Bun gere a resposta, o caller não responde.
 *   - `Response`  → interceptou e recusou (não-upgrade ou falha de upgrade).
 *
 * Cuidado: só intercepta o path EXATO do túnel — não mexe em nenhum outro
 * upgrade-ws que exista na app.
 */
export function tryUpgradeTunnel(
  req: Request,
  server: Server<unknown>,
): Response | null | undefined {
  const url = new URL(req.url);
  if (url.pathname !== proxyTunnelPath()) return null;

  // Só tratamos requests que são de fato upgrade de WebSocket. Um GET normal no
  // path (ex.: curl de teste) cai aqui e devolvemos 426 sem tocar no chisel.
  const upgradeHeader = req.headers.get('upgrade')?.toLowerCase();
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const data: TunnelData = { upstream: null, pending: [], closing: false };
  // Negocia o subprotocolo chisel-v3 de volta pro agente (o chisel client não
  // verifica a resposta, mas servidores WS padrão esperam negociação válida).
  const ok = server.upgrade(req, {
    data,
    headers: { 'Sec-WebSocket-Protocol': CHISEL_PROTOCOL },
  });
  // Upgrade aceito: o Bun assume a resposta — o caller NÃO deve responder nada.
  if (ok) return undefined;
  return new Response('WebSocket upgrade failed', { status: 400 });
}

/**
 * Handler de WebSocket do Bun pro túnel. Plugado no `websocket` do
 * `Bun.serve`/`export default`. Faz o pipe bidirecional agente <-> chisel.
 */
export const tunnelWebSocketHandler = {
  open(ws: ServerWebSocket<TunnelData>) {
    const target = `ws://127.0.0.1:${chiselPort()}`;
    let upstream: WebSocket;
    try {
      // Pede explicitamente o subprotocolo chisel-v3 no upstream — sem isso o
      // chisel server ignora a conexão.
      upstream = new WebSocket(target, [CHISEL_PROTOCOL]);
    } catch {
      try {
        ws.close(1011, 'upstream init failed');
      } catch {
        /* já fechado */
      }
      return;
    }
    upstream.binaryType = 'arraybuffer';
    ws.data.upstream = upstream;

    upstream.addEventListener('open', () => {
      // Drena frames que chegaram do agente antes do upstream abrir.
      for (const frame of ws.data.pending) {
        try {
          upstream.send(frame as string | ArrayBufferLike);
        } catch {
          /* upstream caiu no meio do drain */
        }
      }
      ws.data.pending = [];
    });

    upstream.addEventListener('message', (ev: MessageEvent) => {
      if (ws.data.closing) return;
      try {
        // Encaminha frame do chisel -> agente. Bun ws.send aceita string/binary.
        ws.send(ev.data as string | ArrayBufferLike | Uint8Array);
      } catch {
        /* downstream caiu */
      }
    });

    upstream.addEventListener('close', (ev: CloseEvent) => {
      ws.data.closing = true;
      try {
        ws.close(normalizeCloseCode(ev.code), ev.reason?.slice(0, 120));
      } catch {
        /* já fechado */
      }
    });

    upstream.addEventListener('error', () => {
      ws.data.closing = true;
      try {
        ws.close(1011, 'upstream error');
      } catch {
        /* já fechado */
      }
    });
  },

  message(ws: ServerWebSocket<TunnelData>, message: string | Buffer) {
    const upstream = ws.data.upstream;
    // Normaliza Buffer -> Uint8Array (Bun entrega binário como Buffer).
    const frame = typeof message === 'string' ? message : new Uint8Array(message);
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      // Upstream ainda conectando: enfileira (limita pra evitar memória infinita
      // se o chisel nunca abrir — improvável, mas defensivo).
      if (ws.data.pending.length < 256) ws.data.pending.push(frame);
      return;
    }
    try {
      upstream.send(frame as string | ArrayBufferLike);
    } catch {
      /* upstream caiu */
    }
  },

  close(ws: ServerWebSocket<TunnelData>) {
    ws.data.closing = true;
    const upstream = ws.data.upstream;
    if (upstream && upstream.readyState <= WebSocket.OPEN) {
      try {
        upstream.close();
      } catch {
        /* já fechado */
      }
    }
    ws.data.pending = [];
  },
};

// Códigos de close fora de 1000–4999 (ou os reservados 1005/1006/1015) não podem
// ser repassados num close de WebSocket — viram 1011 (erro interno).
function normalizeCloseCode(code: number): number {
  if (code === 1000) return 1000;
  if (code >= 3000 && code <= 4999) return code;
  return 1011;
}
