"""Testes da query expansion do FTS (spec 047).

`expand_fts_query` é pure function — sem DB. Cobre: expansão gera OR + prefix +
sinônimos, sanitização de operadores de tsquery, query vazia/só-operadores cai
no fallback (string vazia), e o dedup por construção da OR.
"""

from __future__ import annotations

import pytest

from src.fts import expand_fts_query


def _terms(expr: str) -> list[str]:
    return [t.strip() for t in expr.split("|") if t.strip()]


# ---------------------------------------------------------------------------
# R1 — OR + prefix match
# ---------------------------------------------------------------------------


def test_single_term_gets_prefix_and_no_or() -> None:
    expr = expand_fts_query("python")
    assert expr == "python:*"


def test_multiple_terms_joined_with_or_not_and() -> None:
    expr = expand_fts_query("contrato trabalho")
    assert "|" in expr
    assert "&" not in expr
    assert "contrato:*" in _terms(expr)
    assert "trabalho:*" in _terms(expr)


def test_every_term_is_prefix_matched() -> None:
    expr = expand_fts_query("aula gravada")
    for term in _terms(expr):
        assert term.endswith(":*")


# ---------------------------------------------------------------------------
# R2 — sinônimos do mapa curado
# ---------------------------------------------------------------------------


def test_synonyms_are_added_as_or_alternatives() -> None:
    expr = expand_fts_query("marketing")
    terms = _terms(expr)
    assert "marketing:*" in terms
    # sinônimos mapeados entram como alternativas
    assert "publicidade:*" in terms
    assert "propaganda:*" in terms


def test_term_without_synonym_only_itself() -> None:
    expr = expand_fts_query("xilofone")
    assert _terms(expr) == ["xilofone:*"]


def test_synonyms_case_insensitive() -> None:
    expr = expand_fts_query("MARKETING")
    terms = _terms(expr)
    assert "publicidade:*" in terms


def test_multiword_synonym_splits_into_separate_lexemes() -> None:
    # "ia" mapeia o sinônimo multi-palavra "machine learning"; um lexeme com
    # espaço quebraria a tsquery INTEIRA no to_tsquery. Deve virar dois lexemes.
    expr = expand_fts_query("ia")
    terms = _terms(expr)
    assert "machine:*" in terms
    assert "learning:*" in terms
    assert "machine learning:*" not in terms


def test_no_lexeme_contains_space() -> None:
    # Invariante de segurança (R5): nenhum lexeme do output pode ter espaço,
    # senão o to_tsquery falha com syntax error. Cobre os sinônimos
    # multi-palavra do mapa de uma vez.
    queries = ["ia", "inteligência", "marketing vendas", "machine"]
    for q in queries:
        for term in _terms(expand_fts_query(q)):
            assert " " not in term, f"lexeme com espaço em {q!r}: {term!r}"


# ---------------------------------------------------------------------------
# R4 — query vazia / só operadores → fallback (string vazia)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        "",
        "   ",
        "& | ! ( ) : *",
        "''",
        "a",  # termo abaixo do mínimo
        "- -- ---",
    ],
)
def test_unusable_query_returns_empty(query: str) -> None:
    assert expand_fts_query(query) == ""


# ---------------------------------------------------------------------------
# R5 — sanitização de operadores de tsquery (anti-injeção)
# ---------------------------------------------------------------------------


def test_tsquery_operators_are_stripped_from_user_input() -> None:
    # Sintaxe maliciosa não deve sobreviver nem quebrar a tsquery
    expr = expand_fts_query("marketing & (drop) | table:*")
    for term in _terms(expr):
        body = term[:-2]  # remove o sufixo ":*"
        for bad in "&|!()<>:*'\"\\":
            assert bad not in body


def test_no_empty_lexeme_segments() -> None:
    expr = expand_fts_query("foo !! bar")
    # Nenhum segmento vazio entre os pipes
    assert "||" not in expr.replace(" ", "")
    assert all(_terms(expr))


# ---------------------------------------------------------------------------
# R8 — dedup por construção
# ---------------------------------------------------------------------------


def test_duplicate_terms_deduped() -> None:
    expr = expand_fts_query("vendas vendas Vendas")
    terms = _terms(expr)
    assert terms.count("vendas:*") == 1


def test_synonym_overlap_deduped() -> None:
    # "venda" tem sinônimo "vendas"; "vendas" tem sinônimo "venda".
    # A união não deve repetir lexemes.
    expr = expand_fts_query("venda vendas")
    terms = _terms(expr)
    assert len(terms) == len(set(terms))


# ---------------------------------------------------------------------------
# Acentos preservados (dicionário portuguese lida com stemming)
# ---------------------------------------------------------------------------


def test_accents_preserved() -> None:
    expr = expand_fts_query("estratégia")
    terms = _terms(expr)
    assert "estratégia:*" in terms
