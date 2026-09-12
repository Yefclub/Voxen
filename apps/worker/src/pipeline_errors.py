"""Stable public and retryable error contracts for ingestion pipelines."""

from __future__ import annotations

import re

GENERIC_JOB_FAILURE_MESSAGE = (
    "Não foi possível concluir este processamento. Tente novamente; "
    "se o problema continuar, verifique a configuração e os serviços da instância."
)


class PermanentError(Exception):
    """Erro não retentável com mensagem pública opt-in e código interno seguro."""

    def __init__(
        self,
        detail: str = "",
        *,
        code: str = "PERMANENT_FAILURE",
        public_message: str | None = None,
    ) -> None:
        super().__init__(detail or public_message or GENERIC_JOB_FAILURE_MESSAGE)
        self.code = code if re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}", code) else "PERMANENT_FAILURE"
        self.public_message = public_message or GENERIC_JOB_FAILURE_MESSAGE

    @classmethod
    def public(cls, code: str, message: str) -> PermanentError:
        """Cria falha explicitamente segura para Job.errorMsg e SSE."""
        return cls(message, code=code, public_message=message)


class TransientError(Exception):
    """Erro retentável (rede, 5xx)."""


class DeferredJobError(Exception):
    """Signals that a durable job must return to the queue without failing."""

    def __init__(self, detail: str, *, retry_after_seconds: int) -> None:
        super().__init__(detail)
        self.retry_after_seconds = max(1, retry_after_seconds)
