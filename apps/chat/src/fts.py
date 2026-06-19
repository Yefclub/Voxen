"""Query expansion determinística para o FTS de transcrições (spec 047).

Sem embeddings, sem LLM. Reescreve a query do usuário num `tsquery` que:

- une os lexemes com OR (`|`) em vez do AND implícito do `plainto_tsquery`;
- aplica prefix match (`:*`) em cada termo (pega "market" → "marketing");
- injeta sinônimos de um mapa curado PT-BR como alternativas OR.

O dicionário `portuguese` do Postgres já faz stemming (singular/plural e
conjugações colapsam pro mesmo lexema), então NÃO duplicamos isso aqui.

`ts_rank` continua ordenando por relevância: documentos que casam mais termos
sobem. Tudo é pure function — mesma entrada, mesma saída — read-only.
"""

from __future__ import annotations

import re

# Caracteres que são operadores/sintaxe de tsquery. Removidos da entrada do
# usuário pra impedir injeção de sintaxe e erros de parse no Postgres (R5).
_TSQUERY_SPECIALS = re.compile(r"[&|!()<>:*'\"\\]")

# Mantém letras (com acento), dígitos, espaço e hífen interno de palavras.
# Tudo o mais vira espaço — divisor de termos.
_NON_WORD = re.compile(r"[^0-9a-zA-ZÀ-ÿ\s-]+")

# Termos curtos demais raramente ajudam e poluem a OR (stopwords-ish).
_MIN_TERM_LEN = 2

# Teto de termos expandidos pra não montar tsquery gigante.
_MAX_TERMS = 24

# Mapa curado de sinônimos/termos relacionados PT-BR. Chave = lexema-base do
# termo do usuário (lowercase, sem acento removido — comparação é por
# startswith do termo normalizado). Cada termo expande nas alternativas.
# Mantido pequeno e de alto valor; ampliar conforme uso real do acervo.
_SYNONYMS: dict[str, tuple[str, ...]] = {
    "video": ("vídeo", "filmagem", "gravação"),
    "vídeo": ("video", "filmagem", "gravação"),
    "marketing": ("publicidade", "propaganda", "divulgação"),
    "vendas": ("venda", "comercial", "faturamento"),
    "venda": ("vendas", "comercial"),
    "dinheiro": ("grana", "renda", "faturamento", "receita"),
    "empresa": ("negócio", "companhia", "startup"),
    "negócio": ("empresa", "negócios", "empreendimento"),
    "cliente": ("clientes", "consumidor", "comprador"),
    "produto": ("produtos", "mercadoria", "oferta"),
    "estratégia": ("estrategia", "tática", "plano"),
    "investimento": ("investir", "aporte", "aplicação"),
    "aprender": ("aprendizado", "estudar", "estudo"),
    "inteligência": ("ia", "inteligencia"),
    "ia": ("inteligência", "inteligencia", "machine learning"),
}


def _normalize(term: str) -> str:
    return term.strip().lower()


def _tokenize(query: str) -> list[str]:
    cleaned = _TSQUERY_SPECIALS.sub(" ", query)
    cleaned = _NON_WORD.sub(" ", cleaned)
    terms: list[str] = []
    seen: set[str] = set()
    for raw in cleaned.split():
        term = raw.strip("-")
        if len(term) < _MIN_TERM_LEN:
            continue
        key = _normalize(term)
        if key in seen:
            continue
        seen.add(key)
        terms.append(term)
    return terms


def _alternatives(term: str) -> list[str]:
    """Termo + seus sinônimos mapeados (dedup, preservando ordem)."""
    out = [term]
    syns = _SYNONYMS.get(_normalize(term))
    if syns:
        seen = {_normalize(term)}
        for syn in syns:
            key = _normalize(syn)
            if key in seen:
                continue
            seen.add(key)
            out.append(syn)
    return out


def _to_lexeme(term: str) -> str | None:
    """Sanitiza um único termo para um lexeme prefix-match seguro (`termo:*`).

    Retorna None se nada utilizável sobrar após sanitização.
    """
    safe = _TSQUERY_SPECIALS.sub("", term).strip().strip("-")
    if len(safe) < _MIN_TERM_LEN:
        return None
    return f"{safe}:*"


def expand_fts_query(query: str) -> str:
    """Constrói um `tsquery` expandido (OR + prefix + sinônimos) a partir da
    query natural do usuário.

    Retorna string vazia quando nada utilizável sobra — o chamador deve então
    cair pro `plainto_tsquery` (fallback determinístico, R4).
    """
    terms = _tokenize(query)
    if not terms:
        return ""

    lexemes: list[str] = []
    seen: set[str] = set()
    for term in terms:
        for alt in _alternatives(term):
            lexeme = _to_lexeme(alt)
            if not lexeme or lexeme in seen:
                continue
            seen.add(lexeme)
            lexemes.append(lexeme)
            if len(lexemes) >= _MAX_TERMS:
                break
        if len(lexemes) >= _MAX_TERMS:
            break

    return " | ".join(lexemes)
