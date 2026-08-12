"""Localized prompt contract for grounded Brain extraction."""

from __future__ import annotations


def build_grounded_extract_prompt(*, title: str, body: str, language: str) -> tuple[str, str]:
    if language == "en":
        system = (
            "Extract structured knowledge for a personal KB. Reply ONLY with JSON:\n"
            '{"entities":[{"id":"local unique id","label":"...",'
            '"entity_type":"PERSON|ORGANIZATION|PRODUCT|PROJECT|PLACE|CONCEPT|OTHER",'
            '"aliases":["literal alias"],"excerpt":"verbatim quote from the text",'
            '"confidence":0.0-1.0}],'
            '"claims":[{"label":"short factual claim","excerpt":"verbatim quote",'
            '"confidence":0.0-1.0}],'
            '"relations":[{"subject_id":"entity local id",'
            '"subject":"exact extracted label","predicate":"...",'
            '"object_id":"entity local id","object":"exact extracted label",'
            '"kind":"SUPPORTS|CONTRADICTS|SAME_AS|RELATED_TO|PART_OF",'
            '"excerpt":"verbatim quote","confidence":0.0-1.0,'
            '"valid_from":"timezone-aware ISO-8601 or null",'
            '"valid_to":"timezone-aware ISO-8601 or null"}]}\n'
            "excerpt MUST be a contiguous substring of the content. Max 8 entities, 6 claims. "
            "Relations must reference extracted local ids and labels. "
            "SAME_AS only for unambiguous aliases. No invented quotes."
        )
        user = f"Title: {title.strip() or '(none)'}\n\nContent:\n{body}"
        return system, user

    system = (
        "Extraia conhecimento estruturado para uma base pessoal. Responda SÓ JSON:\n"
        '{"entities":[{"id":"id local único","label":"...",'
        '"entity_type":"PERSON|ORGANIZATION|PRODUCT|PROJECT|PLACE|CONCEPT|OTHER",'
        '"aliases":["alias literal"],"excerpt":"trecho literal do texto",'
        '"confidence":0.0-1.0}],'
        '"claims":[{"label":"afirmação curta","excerpt":"trecho literal",'
        '"confidence":0.0-1.0}],'
        '"relations":[{"subject_id":"id local da entidade",'
        '"subject":"rótulo extraído exato","predicate":"...",'
        '"object_id":"id local da entidade","object":"rótulo extraído exato",'
        '"kind":"SUPPORTS|CONTRADICTS|SAME_AS|RELATED_TO|PART_OF",'
        '"excerpt":"trecho literal","confidence":0.0-1.0,'
        '"valid_from":"ISO-8601 com fuso ou null",'
        '"valid_to":"ISO-8601 com fuso ou null"}]}\n'
        "excerpt DEVE ser substring contígua do conteúdo. Máx. 8 entidades, 6 claims. "
        "Relações devem usar ids locais e rótulos extraídos. "
        "SAME_AS só para aliases sem ambiguidade. Sem citações inventadas."
    )
    user = f"Título: {title.strip() or '(sem título)'}\n\nConteúdo:\n{body}"
    return system, user
