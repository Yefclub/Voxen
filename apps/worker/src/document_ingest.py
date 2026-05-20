"""Conversão local de documentos para Markdown via MarkItDown."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from markitdown import MarkItDown

MAX_DOCUMENT_MARKDOWN_CHARS = 180_000


@dataclass(frozen=True)
class DocumentMarkdown:
    markdown: str
    truncated: bool


def is_pdf(path: Path) -> bool:
    return path.suffix.lower() == ".pdf"


async def convert_to_markdown(path: Path) -> DocumentMarkdown:
    """Converte documento local para Markdown sem bloquear o loop."""
    text = await asyncio.to_thread(_convert_sync, path)
    text = _normalize_markdown(text)
    truncated = len(text) > MAX_DOCUMENT_MARKDOWN_CHARS
    if truncated:
        text = text[:MAX_DOCUMENT_MARKDOWN_CHARS].rstrip()
        text += "\n\n[conteúdo truncado pelo limite de contexto do Voxen]"
    return DocumentMarkdown(markdown=text, truncated=truncated)


def _convert_sync(path: Path) -> str:
    md = MarkItDown()
    result = md.convert(str(path))
    text = getattr(result, "text_content", "")
    if not isinstance(text, str):
        text = str(text or "")
    if not text.strip():
        raise RuntimeError("MarkItDown não extraiu texto do documento.")
    return text


def _normalize_markdown(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    normalized = "\n".join(lines).strip()
    while "\n\n\n" in normalized:
        normalized = normalized.replace("\n\n\n", "\n\n")
    return normalized
