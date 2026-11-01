-- Remove configurações órfãs do proxy-agent (spec 215, issue #894).
-- As rotas/UI de geração e revogação foram deletadas; sem esta limpeza os
-- segredos cifrados permaneceriam no DB sem interface para revogar.
-- Idempotente: DELETE é naturalmente re-executável.
DELETE FROM "Setting" WHERE key IN ('proxy_agent_token', 'proxy_agent_enabled', 'yt_dlp_proxy_urls');
