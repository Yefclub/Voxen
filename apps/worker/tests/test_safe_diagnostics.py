from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from src.safe_diagnostics import _ALLOWED_ERROR_CODES, error_diagnostic

_SRC = Path(__file__).resolve().parents[1] / "src"

# Mesma forma que `PermanentError.__init__` exige. Fora dela o código vira
# `PERMANENT_FAILURE` em runtime, então coletá-lo aqui seria falso positivo.
_CODE_SHAPE = re.compile(r"[A-Z][A-Z0-9_]{1,63}$")


def _string_arg(node: ast.Call, index: int) -> str | None:
    if len(node.args) <= index:
        return None
    arg = node.args[index]
    return arg.value if isinstance(arg, ast.Constant) and isinstance(arg.value, str) else None


def _keyword(node: ast.Call, name: str) -> str | None:
    for keyword in node.keywords:
        if keyword.arg == name and isinstance(keyword.value, ast.Constant):
            value = keyword.value.value
            return value if isinstance(value, str) else None
    return None


def _called_name(node: ast.Call) -> str | None:
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    return getattr(func, "id", None)


def _local_diagnostic_names(tree: ast.Module) -> set[str]:
    """Nomes pelos quais `error_diagnostic` é chamável neste arquivo.

    Resolvido a partir do próprio `import`, não fixado como string: `pipeline.py`
    importa `error_diagnostic as _error_diagnostic`, e uma varredura que casasse
    só o nome canônico perderia o maior arquivo do worker inteiro — 12 códigos e
    13 call sites. Lista fixa de apelidos fecharia o caso de hoje e quebraria no
    próximo alias; ler o binding não quebra.
    """
    names = {"error_diagnostic"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and "safe_diagnostics" in node.module:
            for alias in node.names:
                if alias.name == "error_diagnostic":
                    names.add(alias.asname or alias.name)
    return names


def _codes_used_in_source() -> dict[str, set[str]]:
    """Códigos internos que podem chegar a `error_diagnostic`, por arquivo.

    Percorre a AST em vez de casar texto: os códigos entram por dois caminhos,
    e um deles não é literal no ponto da chamada. `pipeline.py` faz
    `error_diagnostic(e, e.code)` sobre um `PermanentError`, então o valor real
    está lá atrás, no `PermanentError.public(...)` que construiu a exceção. Uma
    varredura textual de `error_diagnostic` enxerga só o primeiro caminho e dá
    a lista como completa — foi assim que oito códigos, incluindo
    `OPENROUTER_RATE_LIMITED`, sobreviveram à primeira passada desta correção.
    """
    found: dict[str, set[str]] = {}
    for path in sorted(_SRC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        diagnostic_names = _local_diagnostic_names(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = _called_name(node)
            code: str | None = None
            if name in diagnostic_names:
                code = _string_arg(node, 1) or _keyword(node, "code")
            elif name == "public":
                code = _string_arg(node, 0) or _keyword(node, "code")
            elif name == "PermanentError":
                code = _keyword(node, "code")
            # `public` casa por nome, então qualquer método homônimo entraria
            # aqui. A forma do código é o filtro: um bucket ou caminho não passa.
            if code and _CODE_SHAPE.fullmatch(code):
                found.setdefault(code, set()).add(path.name)
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
    """Guarda do próprio teste: varredura que não acha nada passaria vazia.

    E precisa achar pelos DOIS caminhos — uma que só enxergasse
    `error_diagnostic` daria a lista como completa com oito códigos de fora.
    """
    used = _codes_used_in_source()
    assert len(used) > 60, f"esperava dezenas de call sites, achei {len(used)}"
    assert "BRAIN_EXTRACTION_FAILED" in used, "caminho do error_diagnostic literal"
    assert "OPENROUTER_RATE_LIMITED" in used, "caminho do PermanentError.public"
    # Só alcançável através do import aliasado de `pipeline.py`.
    assert "TIKTOK_PROBE_RETRY" in used, "caminho do error_diagnostic aliasado"


@pytest.mark.parametrize(
    "code",
    [
        # Chegam por `error_diagnostic(exc, "LITERAL")`.
        "RESEARCH_UPSTREAM_UNAVAILABLE",
        "BRAIN_EXTRACTION_SEGMENT_FAILED",
        "SUMMARY_RECONCILIATION_FAILED",
        # Chegam por `error_diagnostic(e, e.code)` sobre um PermanentError.
        "OPENROUTER_RATE_LIMITED",
        "SAVED_MEDIA_TOO_LARGE",
        "SOURCE_REFRESH_MISSING",
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
