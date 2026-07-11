"""Cliente HTTP do OpenRouter — transcrição de áudio e análise visual."""

from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

import httpx

OR_BASE_URL = "https://openrouter.ai/api/v1"


class OpenrouterAuthError(Exception):
    """401/403 da OpenRouter — admin precisa revalidar a key."""


class OpenrouterTransientError(Exception):
    """5xx / timeout / network — retry vale a pena."""


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    cost_usd: Decimal
    model: str


@dataclass(frozen=True)
class VisionAnalysisResult:
    text: str
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


@dataclass(frozen=True)
class DocumentAnalysisResult:
    text: str
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


@dataclass(frozen=True)
class XAnalysisResult:
    text: str
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


@dataclass(frozen=True)
class TitleGenerationResult:
    title: str
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


@dataclass(frozen=True)
class FolderClassificationResult:
    """folder_name=None significa sem pasta (NONE)."""

    folder_name: str | None
    cost_usd: Decimal
    model: str
    tokens_in: int
    tokens_out: int


async def transcribe_audio(
    *,
    audio_path: Path,
    api_key: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> TranscriptionResult:
    """Envia áudio pra OpenRouter `/audio/transcriptions` (compatível Whisper).

    Joga `OpenrouterAuthError` em 401/403 (permanente), `OpenrouterTransientError`
    em 5xx/timeout/rede (retry vale a pena), outros erros viram `RuntimeError`.
    """
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=180.0)
    try:
        audio_format = audio_path.suffix.lower().lstrip(".") or "ogg"
        if audio_format == "oga":
            audio_format = "ogg"
        payload = {
            "model": model,
            "input_audio": {
                "data": base64.b64encode(audio_path.read_bytes()).decode("ascii"),
                "format": audio_format,
            },
            "response_format": "json",
        }
        try:
            res = await client.post(
                f"{OR_BASE_URL}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as e:
            raise OpenrouterTransientError(f"Rede/timeout: {e}") from e
        if res.status_code in (401, 403):
            raise OpenrouterAuthError(f"OpenRouter rejeitou a key (HTTP {res.status_code})")
        if 500 <= res.status_code < 600:
            raise OpenrouterTransientError(f"OpenRouter {res.status_code}")
        if not res.is_success:
            raise RuntimeError(f"OpenRouter erro inesperado HTTP {res.status_code}: {res.text}")
        body = res.json()
        text = body.get("text", "")
        # OpenRouter ecoa custo em headers `x-ratelimit-...` ou no corpo `usage`.
        usage = body.get("usage", {})
        cost_str = usage.get("cost") or usage.get("total_cost") or "0"
        try:
            cost = Decimal(str(cost_str))
        except (ValueError, ArithmeticError):
            cost = Decimal("0")
        return TranscriptionResult(text=text, cost_usd=cost, model=model)
    finally:
        if owns_client:
            await client.aclose()


async def analyze_image(
    *,
    image_path: Path,
    api_key: str,
    model: str,
    prompt: str,
    client: httpx.AsyncClient | None = None,
) -> VisionAnalysisResult:
    """Analisa uma imagem via `/chat/completions` multimodal do OpenRouter."""
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
        raise RuntimeError(f"Formato de imagem não suportado: {mime}")

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=120.0)
    try:
        data_url = f"data:{mime};base64,{base64.b64encode(image_path.read_bytes()).decode('ascii')}"
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Você analisa imagens para uma base de conhecimento pessoal. "
                        "Responda em português do Brasil, com descrição objetiva, "
                        "texto visível/OCR quando houver e pontos relevantes para busca futura."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            "usage": {"include": True},
        }
        try:
            res = await client.post(
                f"{OR_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            raise OpenrouterTransientError(f"Rede/timeout: {e}") from e

        if res.status_code in (401, 403):
            raise OpenrouterAuthError(f"OpenRouter rejeitou a key (HTTP {res.status_code})")
        if 500 <= res.status_code < 600:
            raise OpenrouterTransientError(f"OpenRouter {res.status_code}")
        if not res.is_success:
            raise RuntimeError(f"OpenRouter erro inesperado HTTP {res.status_code}: {res.text}")

        body = res.json()
        choices = body.get("choices") or []
        message = (choices[0] if choices else {}).get("message") or {}
        content = message.get("content") or ""
        if isinstance(content, list):
            text = "\n".join(
                str(part.get("text") or "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            )
        else:
            text = str(content)

        usage = body.get("usage") or {}
        cost_raw = usage.get("cost") or "0"
        try:
            cost = Decimal(str(cost_raw))
        except (ValueError, ArithmeticError):
            cost = Decimal("0")
        return VisionAnalysisResult(
            text=text.strip(),
            cost_usd=cost,
            model=model,
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
        )
    finally:
        if owns_client:
            await client.aclose()


async def analyze_document_text(
    *,
    markdown: str,
    filename: str,
    api_key: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> DocumentAnalysisResult:
    """Analisa Markdown extraído localmente de um documento."""
    prompt = (
        f"Documento: {filename}\n\n"
        "Analise este documento para uma base de conhecimento. Entregue em português do Brasil:\n"
        "1. Resumo executivo curto.\n"
        "2. Principais pontos, decisões, dados e entidades.\n"
        "3. Trechos ou tabelas importantes preservando estrutura quando útil.\n"
        "4. Palavras-chave pesquisáveis.\n\n"
        "Conteúdo em Markdown extraído:\n\n"
        "```markdown\n"
        f"{markdown}\n"
        "```"
    )
    payload = _document_payload(model=model, user_content=prompt)
    return await _chat_completion_document(
        payload=payload, api_key=api_key, model=model, client=client
    )


async def analyze_pdf_native(
    *,
    pdf_path: Path,
    api_key: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> DocumentAnalysisResult:
    """Analisa PDF enviado nativamente à OpenRouter usando engine `native`."""
    data_url = "data:application/pdf;base64," + base64.b64encode(pdf_path.read_bytes()).decode(
        "ascii"
    )
    payload = _document_payload(
        model=model,
        user_content=[
            {
                "type": "text",
                "text": (
                    "Analise este PDF para uma base de conhecimento. Responda em português "
                    "do Brasil com resumo executivo, pontos principais, dados relevantes, "
                    "trechos importantes e palavras-chave pesquisáveis."
                ),
            },
            {
                "type": "file",
                "file": {
                    "filename": pdf_path.name,
                    "file_data": data_url,
                },
            },
        ],
        plugins=[
            {
                "id": "file-parser",
                "pdf": {"engine": "native"},
            }
        ],
    )
    return await _chat_completion_document(
        payload=payload, api_key=api_key, model=model, client=client
    )


async def analyze_x_url(
    *,
    url: str,
    api_key: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> XAnalysisResult:
    """Analisa post/thread do X usando Grok via OpenRouter com busca nativa."""
    prompt = (
        "Analise este post ou thread do X para uma base de conhecimento.\n\n"
        f"URL: {url}\n\n"
        "Entregue em português do Brasil, em Markdown pesquisável:\n"
        "1. Resumo objetivo do conteúdo.\n"
        "2. Contexto, autor/perfil citado, entidades e links relevantes.\n"
        "3. Pontos verificáveis, ressalvas e incertezas.\n"
        "4. Palavras-chave para busca futura.\n\n"
        "Use a busca nativa no X quando disponível. Se o conteúdo não estiver "
        "acessível, diga isso explicitamente e não invente detalhes."
    )
    payload: dict[str, object] = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Você analisa publicações do X para uma base de conhecimento pessoal. "
                    "Use dados recuperados pela busca nativa do X/OpenRouter, seja objetivo, "
                    "cite URLs relevantes quando existirem e escreva em português do Brasil."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "plugins": [{"id": "web", "engine": "native"}],
        "x_search_filter": {
            "enable_image_understanding": True,
            "enable_video_understanding": True,
        },
        "usage": {"include": True},
    }
    result = await _chat_completion_document(
        payload=payload, api_key=api_key, model=model, client=client
    )
    return XAnalysisResult(
        text=result.text,
        cost_usd=result.cost_usd,
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )


async def generate_content_title(
    *,
    content: str,
    source_label: str,
    fallback_title: str,
    api_key: str,
    model: str,
    language: str = "pt-BR",
    client: httpx.AsyncClient | None = None,
) -> TitleGenerationResult:
    """Avalia o título candidato e, se fraco, gera um editorial curto.

    Contrato da resposta do modelo:
    - `KEEP` (ou o título candidato idêntico) → manter `fallback_title`
    - qualquer outro texto → usar como novo título (sanitizado)
    """
    candidate = _clean_generated_title(fallback_title) or fallback_title.strip()
    excerpt = content.strip().replace("\x00", " ")[:8_000]
    lang = "en" if language == "en" else "pt-BR"
    if lang == "en":
        prompt = (
            f"Source: {source_label}\n"
            f"Candidate title: {candidate or '(empty)'}\n\n"
            "You choose the final title for this content in a personal knowledge base.\n"
            "Rules:\n"
            "1. If the candidate is already a good editorial title (clear, specific, "
            "useful to find later), reply exactly: KEEP\n"
            "2. Otherwise reply only with a short English editorial title "
            "(max 80 characters). No quotes. No trailing period. "
            "Preserve proper names and the main topic.\n"
            "3. Weak titles to replace: filename, generic ID, hostname, "
            "'X post …', '(no title)', emoji-only, or overly vague titles.\n"
            "\n\n"
            f"Content:\n{excerpt}"
        )
        system = (
            "You pick precise titles for a personal knowledge base. "
            "Reply only with KEEP or the final title."
        )
    else:
        prompt = (
            f"Fonte: {source_label}\n"
            f"Título candidato: {candidate or '(vazio)'}\n\n"
            "Você decide o título final deste conteúdo para uma base de conhecimento pessoal.\n"
            "O título final DEVE estar em português do Brasil.\n"
            "Regras:\n"
            "1. Só responda KEEP se o título candidato já for um bom título editorial "
            "(claro, específico, útil para achar o conteúdo depois) E já estiver em "
            "português do Brasil.\n"
            "2. Caso contrário, responda apenas com um título editorial curto em português "
            "do Brasil (máximo 80 caracteres). Isso inclui TRADUZIR/adaptar para o "
            "português um título que esteja em outro idioma, mesmo que ele já seja bom. "
            "Não use aspas. Não use ponto final. Preserve nomes próprios, marcas e "
            "títulos de obras.\n"
            "3. Títulos fracos a substituir: nome de arquivo, ID genérico, hostname, "
            "'Post do X …', '(sem título)', só emoji, ou título vago demais.\n"
            "\n\n"
            f"Conteúdo:\n{excerpt}"
        )
        system = (
            "Você escolhe títulos precisos, em português do Brasil, para uma base de "
            "conhecimento pessoal. Responda apenas com KEEP (somente se o candidato já "
            "estiver em português do Brasil) ou com o título final em português."
        )
    payload: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 64,
        # Título é um one-shot curto: desabilita reasoning para o stream de
        # raciocínio NÃO vazar no message.content (issue #335). Modelos sem
        # reasoning ignoram o campo. max_tokens curto cortava o raciocínio no
        # meio e o preâmbulo truncado virava "título".
        "reasoning": {"enabled": False},
        "usage": {"include": True},
    }
    result = await _chat_completion_document(
        payload=payload, api_key=api_key, model=model, client=client
    )
    title = _resolve_title_decision(result.text, candidate or fallback_title)
    return TitleGenerationResult(
        title=title or candidate or fallback_title[:80] or "Conteúdo sem título",
        cost_usd=result.cost_usd,
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )


# Prefixos de preâmbulo/raciocínio que o modelo às vezes cospe em vez de um
# título (issue #335). Se o "título" começa assim, é meta-texto → cai no
# fallback em vez de persistir lixo como "The candidate title is ...".
_TITLE_META_PREFIXES: tuple[str, ...] = (
    "the candidate title",
    "the user wants",
    "the user is",
    "the user asked",
    "the final title",
    "a good title",
    "based on the content",
    "the content is about",
    "here is",
    "here's",
    "let me",
    "i'll",
    "i will",
    "i would",
    "sure,",
    "okay,",
    "título:",
    "título final",
    "title:",
)


def _looks_like_title_preamble(title: str) -> bool:
    """True se o "título" parece preâmbulo/raciocínio do modelo (issue #335)."""
    low = title.strip().casefold()
    if not low:
        return False
    return any(low.startswith(prefix) for prefix in _TITLE_META_PREFIXES)


def _resolve_title_decision(raw: str, fallback_title: str) -> str:
    """Interpreta a resposta do modelo: KEEP / título idêntico / título novo."""
    cleaned = _clean_generated_title(raw)
    if not cleaned:
        return _clean_generated_title(fallback_title) or fallback_title.strip()
    token = cleaned.upper()
    if token in {"KEEP", "MANTER", "KEEP TITLE", "KEEP_TITLE"}:
        return _clean_generated_title(fallback_title) or fallback_title.strip()
    fallback_clean = _clean_generated_title(fallback_title)
    if fallback_clean and cleaned.casefold() == fallback_clean.casefold():
        return fallback_clean
    # Rede de segurança: preâmbulo/raciocínio vazado nunca vira título.
    if _looks_like_title_preamble(cleaned):
        return fallback_clean or fallback_title.strip()
    return cleaned


def _clean_generated_title(value: str) -> str:
    title = " ".join(value.replace("\n", " ").split()).strip(" \"'“”‘’#:-")
    if not title:
        return ""
    if len(title) > 90:
        title = title[:90].rsplit(" ", 1)[0] or title[:80]
    return title.strip(" .")


_FOLDER_META_PREFIXES: tuple[str, ...] = (
    "the content is about",
    "the content is a",
    "the content is an",
    "this content is about",
    "this is about",
    "this is a",
    "this is an",
    "it's about",
    "its about",
    "content about",
    "category:",
    "folder:",
    "pasta:",
    "label:",
    "topic:",
    "the topic is",
    "the subject is",
    "based on the content",
    "looking at the content",
)

_FOLDER_BAD_MARKERS: tuple[str, ...] = (
    "the user",
    "i want",
    "i will",
    "i need",
    "i should",
    "let me",
    "categorize",
    "categorise",
    "classif",
    "organize",
    "organise",
    "please",
    "respond",
    "json",
    "folder name",
    "nome da pasta",
    "o conteúdo",
    "este conteúdo",
)


async def classify_content_folder(
    *,
    title: str,
    content: str,
    existing_folders: list[str],
    api_key: str,
    model: str,
    language: str = "pt-BR",
    client: httpx.AsyncClient | None = None,
) -> FolderClassificationResult:
    """Classifica o conteúdo em uma pasta (1:1) reutilizando nomes existentes quando couber."""
    excerpt = content.strip().replace("\x00", " ")[:4_000]
    folders_block = (
        "\n".join(f"- {name}" for name in existing_folders[:80])
        if existing_folders
        else "(none yet)"
    )
    lang = "en" if language == "en" else "pt-BR"
    if lang == "en":
        system = (
            "You label personal knowledge-base folders. "
            "Reply with ONE short folder label only (1-4 words), or NONE. "
            "Never write a sentence. Never start with 'The content is about'."
        )
        prompt = (
            f"Title: {title.strip() or '(no title)'}\n"
            f"Existing folders:\n{folders_block}\n\n"
            'Return JSON only: {"folder":"Short Label"} or {"folder":null}\n'
            "GOOD: HyperDX, Elden Ring, Alibaba Cloud, TypeScript, Claude Code\n"
            "BAD: The content is about..., The user wants..., incomplete phrases\n"
            "Reuse an existing folder name when it fits.\n\n"
            f"Content excerpt:\n{excerpt}"
        )
    else:
        system = (
            "Você nomeia pastas de uma base de conhecimento pessoal. "
            "Responda só com um rótulo curto (1-4 palavras) ou null. "
            "Nunca escreva frase. Nunca comece com 'The content is about' ou 'O conteúdo'."
        )
        prompt = (
            f"Título: {title.strip() or '(sem título)'}\n"
            f"Pastas existentes:\n{folders_block}\n\n"
            'Responda APENAS JSON: {"folder":"Rótulo Curto"} ou {"folder":null}\n'
            "BONS: HyperDX, Elden Ring, Alibaba Cloud, TypeScript, Claude Code\n"
            "RUINS: The content is about..., The user wants..., frases incompletas\n"
            "Reutilize pasta existente. Prefira nome do produto/tema, não descrição.\n\n"
            f"Trecho do conteúdo:\n{excerpt}"
        )
    payload: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "max_tokens": 48,
        "usage": {"include": True},
    }
    # Preferimos JSON no prompt (não response_format) — alguns modelos na
    # OpenRouter rejeitam response_format e falhariam a classificação inteira.
    result = await _chat_completion_document(
        payload=payload, api_key=api_key, model=model, client=client
    )
    folder_name = _resolve_folder_decision(result.text, existing_folders)
    return FolderClassificationResult(
        folder_name=folder_name,
        cost_usd=result.cost_usd,
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )


def _resolve_folder_decision(raw: str, existing_folders: list[str]) -> str | None:
    """Extrai rótulo de pasta válido; rejeita frases meta do modelo."""
    text = (raw or "").strip()
    if not text:
        return None

    # Tenta JSON {"folder": "..."}
    extracted = _extract_folder_from_json(text)
    if extracted is not None:
        text = extracted
    else:
        # primeira linha útil
        for line in text.splitlines():
            line = line.strip().strip("`")
            if line and not line.startswith(("{", "[")):
                text = line
                break

    cleaned = " ".join(text.replace("\n", " ").split()).strip(" \"'“”‘’#.*")
    if not cleaned:
        return None

    # Rejeita raciocínio/instrução do modelo ANTES de truncar ou strip de artigos.
    if _has_folder_meta_markers(cleaned):
        return None

    cleaned = _strip_folder_meta_prefix(cleaned)
    cleaned = cleaned.strip(" \"'“”‘’#.*")
    if not cleaned:
        return None

    token = cleaned.upper().strip()
    if token in {"NONE", "NENHUMA", "N/A", "NA", "NULL", "UNDEFINED", "NULO"}:
        return None

    # Prefere match exato (case-insensitive) com pasta existente.
    for name in existing_folders:
        if name.casefold() == cleaned.casefold():
            return name

    # Match por tokens iguais (evita "ia" ∈ "história").
    cleaned_tokens = {t for t in cleaned.casefold().replace("-", " ").split() if len(t) >= 3}
    for name in existing_folders:
        name_tokens = {t for t in name.casefold().replace("-", " ").split() if len(t) >= 3}
        if cleaned_tokens and name_tokens and cleaned_tokens == name_tokens:
            return name

    name = cleaned.strip(" .:-")
    # Máx. 4 palavras / 40 chars — pastas são rótulos, não frases.
    words = name.split()
    if len(words) > 4:
        name = " ".join(words[:4])
    if len(name) > 40:
        name = name[:40].rsplit(" ", 1)[0] or name[:40]
    name = name.strip(" .:-\"'“”‘’")

    if len(name) < 2:
        return None
    if _is_bad_folder_label(name):
        return None
    return name


def _extract_folder_from_json(raw: str) -> str | None:
    import json
    import re

    text = raw.strip()
    # bloco ```json ... ```
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1)
    else:
        # primeiro objeto { ... }
        brace = re.search(r"\{[^{}]*\}", text, re.DOTALL)
        if brace:
            text = brace.group(0)
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    for key in ("folder", "name", "label", "pasta", "category"):
        if key in data:
            val = data[key]
            if val is None:
                return "NONE"
            if isinstance(val, str):
                return val.strip()
    return None


def _strip_folder_meta_prefix(value: str) -> str:
    import re

    rest = value
    lower = rest.casefold()
    matched = False
    for prefix in _FOLDER_META_PREFIXES:
        if lower.startswith(prefix):
            rest = rest[len(prefix) :].strip(" :,-–—\"'“”‘’")
            matched = True
            break
    # truncamento do modelo: "HyperDX, an" / "Observe, a"
    rest = re.sub(r",\s*(a|an|the|um|uma)\s*$", "", rest, flags=re.IGNORECASE).strip()
    # artigo / filler só após meta: "an Elden Ring game" → "Elden Ring game"
    if matched:
        rest = re.sub(
            r"^(a|an|the|um|uma|using|about)\s+",
            "",
            rest,
            count=1,
            flags=re.IGNORECASE,
        ).strip()
    return rest.strip(" \"'“”‘’")


def _has_folder_meta_markers(value: str) -> bool:
    """Detecta raciocínio do modelo / instruções de prompt no texto bruto."""
    lower = value.casefold()
    for marker in _FOLDER_BAD_MARKERS:
        if marker in lower:
            return True
    # "The content is about X" ainda pode ser recuperável via strip.
    if any(lower.startswith(p) for p in _FOLDER_META_PREFIXES):
        return False
    words = lower.split()
    # frases longas em inglês que claramente não são rótulo
    if len(words) > 6:
        return True
    if words and words[0] in {"the", "this", "that", "i", "we", "you"} and len(words) > 3:
        return True
    return False


def _is_bad_folder_label(name: str) -> bool:
    lower = name.casefold()
    words = lower.split()
    if len(words) > 4:
        return True
    # frases incompletas
    if lower.endswith(
        (
            " a",
            " an",
            " the",
            " of",
            " for",
            " to",
            " and",
            " or",
            " called",
            " about",
            " with",
            " from",
            " is",
            " are",
            " uma",
            " um",
            " de",
            " da",
            " do",
        )
    ):
        return True
    # parece sentença em inglês genérica
    if words and words[0] in {
        "the",
        "this",
        "that",
        "these",
        "those",
        "a",
        "an",
        "i",
        "we",
        "you",
        "my",
        "our",
        "user",
    }:
        return True
    # muito genérico / incompleto
    if lower in {
        "content",
        "conteúdo",
        "misc",
        "other",
        "geral",
        "various",
        "stuff",
        "open-source",
        "open source",
        "library",
        "tool",
        "checklist",
        "game",
        "shift",
    }:
        return True
    return False


def _document_payload(
    *,
    model: str,
    user_content: str | list[dict[str, object]],
    plugins: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Você analisa documentos para uma base de conhecimento pessoal. "
                    "Seja objetivo, preserve dados úteis, destaque entidades e escreva "
                    "em Markdown pesquisável em português do Brasil."
                ),
            },
            {
                "role": "user",
                "content": user_content,
            },
        ],
        "usage": {"include": True},
    }
    if plugins:
        payload["plugins"] = plugins
    return payload


async def _chat_completion_document(
    *,
    payload: dict[str, object],
    api_key: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> DocumentAnalysisResult:
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=180.0)
    try:
        try:
            res = await client.post(
                f"{OR_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            raise OpenrouterTransientError(f"Rede/timeout: {e}") from e

        if res.status_code in (401, 403):
            raise OpenrouterAuthError(f"OpenRouter rejeitou a key (HTTP {res.status_code})")
        if 500 <= res.status_code < 600:
            raise OpenrouterTransientError(f"OpenRouter {res.status_code}")
        if not res.is_success:
            raise RuntimeError(f"OpenRouter erro inesperado HTTP {res.status_code}: {res.text}")

        body = res.json()
        choices = body.get("choices") or []
        message = (choices[0] if choices else {}).get("message") or {}
        content = message.get("content") or ""
        if isinstance(content, list):
            text = "\n".join(
                str(part.get("text") or "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            )
        else:
            text = str(content)

        usage = body.get("usage") or {}
        cost_raw = usage.get("cost") or "0"
        try:
            cost = Decimal(str(cost_raw))
        except (ValueError, ArithmeticError):
            cost = Decimal("0")
        return DocumentAnalysisResult(
            text=text.strip(),
            cost_usd=cost,
            model=model,
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
        )
    finally:
        if owns_client:
            await client.aclose()
