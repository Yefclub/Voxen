from __future__ import annotations

import re
from pathlib import Path

import pytest

from src.safe_diagnostics import _ALLOWED_ERROR_CODES, error_diagnostic

_SRC = Path(__file__).resolve().parents[1] / "src"
_CALL = re.compile(r'error_diagnostic\([^,]+,\s*"([A-Z_]+)"')


def _codes_used_in_source() -> dict[str, list[str]]:
    """Códigos passados a `error_diagnostic`, por arquivo que os usa."""
    found: dict[str, list[str]] = {}
    for path in sorted(_SRC.rglob("*.py")):
        for code in _CALL.findall(path.read_text(encoding="utf-8")):
            found.setdefault(code, []).append(path.name)
    return found


def test_every_code_passed_in_source_is_allowlisted() -> None:
    """A allowlist tem que cobrir tudo que o worker realmente passa.

    Código fora dela não vira erro: `error_diagnostic` o troca em silêncio por
    `UNEXPECTED_FAILURE`. O efeito só aparece em produção, como log que perdeu a
    atribuição — foi assim que a família `RESEARCH_*` inteira ficou opaca, e uma
    indisponibilidade da OpenRouter passou a ser indistinguível de qualquer
    outra falha inesperada.
    """
    used = _codes_used_in_source()
    missing = {code: files for code, files in used.items() if code not in _ALLOWED_ERROR_CODES}

    detail = "\n".join(
        f"  {code}  ({', '.join(sorted(set(files)))})" for code, files in sorted(missing.items())
    )
    assert not missing, (
        "Códigos usados no worker mas ausentes de _ALLOWED_ERROR_CODES — "
        f"seriam logados como UNEXPECTED_FAILURE:\n{detail}"
    )


def test_the_scan_actually_finds_call_sites() -> None:
    """Guarda do próprio teste: regex que não casa nada passaria vazio."""
    used = _codes_used_in_source()
    assert len(used) > 30, f"esperava dezenas de call sites, achei {len(used)}"
    assert "BRAIN_EXTRACTION_FAILED" in used


@pytest.mark.parametrize(
    "code",
    [
        "RESEARCH_UPSTREAM_UNAVAILABLE",
        "BRAIN_EXTRACTION_SEGMENT_FAILED",
        "SUMMARY_RECONCILIATION_FAILED",
    ],
)
def test_previously_swallowed_codes_survive(code: str) -> None:
    """Os que produziam UNEXPECTED_FAILURE nos logs de produção."""
    assert error_diagnostic(TimeoutError("x"), code)["error_code"] == code


def test_unknown_code_still_falls_back() -> None:
    """A allowlist continua sendo allowlist: string arbitrária não passa."""
    assert error_diagnostic(TimeoutError("x"), "NAO_EXISTE")["error_code"] == "UNEXPECTED_FAILURE"


def test_error_type_is_normalized_and_message_never_leaks() -> None:
    """Razão de existir do módulo: nada da mensagem externa entra no log."""
    diagnostic = error_diagnostic(TimeoutError("segredo: token=abc123"), "SUMMARY_FAILED")
    assert diagnostic == {"error_code": "SUMMARY_FAILED", "error_type": "TimeoutError"}

    class WeirdError(Exception):
        pass

    assert error_diagnostic(WeirdError("x"), "SUMMARY_FAILED")["error_type"] == "Exception"
