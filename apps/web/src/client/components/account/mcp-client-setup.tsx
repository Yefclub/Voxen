import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Plug } from '@/components/ui/icons';
import type { Locale } from '../../lib/i18n';
import { mcpClientSetups, type McpClientId } from '../../lib/mcp-client-setup';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

type Props = {
  locale: Locale;
  endpoint: string;
  visibleToken: string | null;
  onCopyError: () => void;
};

export function McpClientSetup({
  locale,
  endpoint,
  visibleToken,
  onCopyError,
}: Props): React.ReactElement {
  const copy = locale === 'en' ? 'Copy' : 'Copiar';
  const copiedLabel = locale === 'en' ? 'Copied' : 'Copiado';
  const [selected, setSelected] = useState<McpClientId>('codex');
  const [copied, setCopied] = useState<'endpoint' | 'config' | null>(null);
  const setups = useMemo(() => mcpClientSetups(locale, endpoint), [endpoint, locale]);
  const setup = setups.find((candidate) => candidate.id === selected) ?? setups[0]!;
  const docsUrl =
    locale === 'en'
      ? 'https://github.com/Yefclub/Voxen/blob/main/docs/en/MCP.md'
      : 'https://github.com/Yefclub/Voxen/blob/main/docs/MCP.md';

  async function copyValue(value: string, target: 'endpoint' | 'config'): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      onCopyError();
    }
  }

  const statusLabel =
    setup.status === 'supported'
      ? locale === 'en'
        ? 'Supported with token'
        : 'Suportado com token'
      : setup.status === 'conditional'
        ? setup.id === 'grok'
          ? locale === 'en'
            ? 'Validation pending'
            : 'Validação pendente'
          : locale === 'en'
            ? 'Version-dependent'
            : 'Depende da versão'
        : locale === 'en'
          ? 'OAuth required'
          : 'Exige OAuth';

  return (
    <Card elevated>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 font-display">
              <Plug className="h-4 w-4 text-violet-400" />
              {locale === 'en' ? 'Connect a client' : 'Conectar um cliente'}
            </CardTitle>
            <CardDescription>
              {locale === 'en'
                ? 'Streamable HTTP with a personal, user-scoped Bearer token.'
                : 'Streamable HTTP com token Bearer pessoal e isolado por usuário.'}
            </CardDescription>
          </div>
          <Button asChild type="button" variant="outline" size="sm">
            <a href={docsUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              {locale === 'en' ? 'Complete guide' : 'Guia completo'}
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-app-muted)]">
            Endpoint
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={endpoint} className="min-w-0 font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyValue(endpoint, 'endpoint')}
            >
              {copied === 'endpoint' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === 'endpoint' ? copiedLabel : copy}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="MCP clients">
          {setups.map((candidate) => (
            <Button
              key={candidate.id}
              type="button"
              size="sm"
              variant={candidate.id === setup.id ? 'secondary' : 'ghost'}
              aria-pressed={candidate.id === setup.id}
              onClick={() => setSelected(candidate.id)}
            >
              {candidate.label}
            </Button>
          ))}
        </div>

        <div className="space-y-3 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-subtle)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--color-app-fg)]">{setup.label}</p>
            <Badge
              variant={
                setup.status === 'supported'
                  ? 'success'
                  : setup.status === 'unsupported'
                    ? 'warning'
                    : 'outline'
              }
            >
              {statusLabel}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-app-muted)]">{setup.summary}</p>
          <Textarea readOnly value={setup.config} rows={6} className="font-mono text-xs" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--color-app-muted)]">
              {setup.id === 'grok'
                ? locale === 'en'
                  ? 'OAuth must be enabled by the administrator. Do not paste a personal token into Grok.'
                  : 'O administrador precisa habilitar OAuth. Não cole token pessoal no Grok.'
                : setup.status === 'unsupported'
                  ? locale === 'en'
                    ? 'OAuth is required; no personal token is included in this configuration.'
                    : 'OAuth é obrigatório; nenhum token pessoal aparece nesta configuração.'
                  : visibleToken
                    ? locale === 'en'
                      ? 'Your token remains in the credential card; examples use an environment variable or placeholder to avoid persisting it accidentally.'
                      : 'Seu token continua no cartão de credencial; os exemplos usam variável de ambiente ou placeholder para evitar persistência acidental.'
                    : locale === 'en'
                      ? 'Set VOXEN_MCP_TOKEN or replace the placeholder with a newly created token.'
                      : 'Defina VOXEN_MCP_TOKEN ou troque o placeholder por um token recém-criado.'}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={setup.status === 'unsupported'}
              onClick={() => void copyValue(setup.config, 'config')}
            >
              {copied === 'config' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === 'config' ? copiedLabel : copy}
            </Button>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-amber-300/90">
          {locale === 'en'
            ? 'Tokens are shown once, must never be placed in URLs, and can be revoked without affecting your Voxen login.'
            : 'Tokens aparecem uma vez, nunca devem ir em URLs e podem ser revogados sem afetar seu login no Voxen.'}
        </p>
      </CardContent>
    </Card>
  );
}
