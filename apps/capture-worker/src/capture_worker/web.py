"""Generic web pages (Trafilatura) and direct PDF / text links."""

from __future__ import annotations

import json
import os
import re
import sys
import uuid
from typing import Any

import trafilatura
from lxml import html as lxml_html
from pypdf import PdfReader

from . import config, http, images, proc
from .errors import NO_TEXT, UNSUPPORTED, CaptureError, error
from .result import empty_result, iso_date, language_code

_HTML_TYPES = ("text/html", "application/xhtml+xml")


async def extract(url: str, tmp_dir: str) -> dict[str, Any]:
    fetched = await http.fetch(url, max_bytes=config.MAX_PAGE_BYTES)
    ctype = fetched.content_type.split(";", 1)[0].strip()
    body = fetched.body
    if ctype == "application/pdf" or body.startswith(b"%PDF-"):
        text, title = await pdf_text_isolated(_spill(body, tmp_dir, ".pdf"), tmp_dir)
        result = empty_result("web", fetched.url, "pypdf")
        result.update(title=title, text=text, textKind="page")
        _require_text(result)
        return result
    if ctype.startswith("image/"):
        result = empty_result("web", fetched.url, "direct")
        result["images"] = await images.download([("post_media", fetched.url)], tmp_dir)
        if not result["images"]:
            raise error(UNSUPPORTED)
        return result
    if ctype in ("text/plain", "text/markdown"):
        result = empty_result("web", fetched.url, "direct")
        result.update(text=body.decode("utf-8", errors="replace").strip(), textKind="page")
        _require_text(result)
        return result
    if ctype and ctype not in _HTML_TYPES and not ctype.startswith("text/"):
        raise error(UNSUPPORTED)
    result = await parse_html_isolated(_spill(body, tmp_dir, ".html"), fetched.url, tmp_dir)
    og_image = result.pop("_og_image", None)
    _require_text(result)
    if og_image:
        result["images"] = await images.download([("og_image", og_image)], tmp_dir)
    return result


def parse_html(body: bytes, url: str) -> dict[str, Any]:
    text = trafilatura.extract(
        body,
        url=url,
        output_format="markdown",
        include_comments=False,
        include_tables=True,
        include_images=False,
        include_links=False,
        favor_recall=True,
        deduplicate=True,
    )
    meta = trafilatura.extract_metadata(body, default_url=url)
    result = empty_result("web", url, "trafilatura")
    language = _html_lang(body)
    if meta is not None:
        result.update(
            title=meta.title or None,
            author=meta.author or None,
            channel=meta.sitename or None,
            publishedAt=iso_date(meta.date),
            description=meta.description or None,
        )
        result["_og_image"] = meta.image or None
    result.update(text=(text or "").strip() or None, textKind="page", language=language)
    return result


def _html_lang(body: bytes) -> str | None:
    try:
        root = lxml_html.fromstring(body[:200_000])
    except (ValueError, lxml_html.etree.ParserError):
        return None
    return language_code(root.get("lang") or root.get("xml:lang"))


def _spill(body: bytes, tmp_dir: str, suffix: str) -> str:
    path = os.path.join(tmp_dir, f"parse-{uuid.uuid4().hex}{suffix}")
    with open(path, "wb") as handle:
        handle.write(body)
    return path


def _parse_command() -> list[str]:
    return [sys.executable, os.path.join(os.path.dirname(__file__), "parse_child.py")]


async def _run_child(args: list[str], tmp_dir: str) -> dict[str, Any]:
    result = await proc.run(
        [*_parse_command(), *args],
        tmp_dir=tmp_dir,
        timeout=config.PARSE_TIMEOUT_SEC,
    )
    try:
        payload = json.loads(result.stdout or b"{}")
    except ValueError:
        payload = {}
    if result.returncode != 0 or not isinstance(payload, dict) or "error" in payload:
        code = payload.get("error") if isinstance(payload, dict) else None
        raise error(NO_TEXT if code == NO_TEXT else UNSUPPORTED)
    return payload


async def pdf_text_isolated(path: str, tmp_dir: str) -> tuple[str | None, str | None]:
    payload = await _run_child(["pdf", path], tmp_dir)
    return payload.get("text"), payload.get("title")


async def parse_html_isolated(path: str, url: str, tmp_dir: str) -> dict[str, Any]:
    return await _run_child(["html", path, url], tmp_dir)


def pdf_text_from_path(path: str) -> tuple[str | None, str | None]:
    """Runs only inside parse_child; reads the PDF lazily from disk."""
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise error(UNSUPPORTED)
        parts: list[str] = []
        for index, page in enumerate(reader.pages):
            if index >= config.MAX_PDF_PAGES:
                break
            parts.append(page.extract_text() or "")
        title = None
        if reader.metadata is not None and reader.metadata.title:
            title = str(reader.metadata.title).strip() or None
    except CaptureError:
        raise
    except Exception as exc:
        raise error(UNSUPPORTED) from exc
    text = re.sub(r"\n{3,}", "\n\n", "\n\n".join(p.strip() for p in parts if p.strip()))
    return (text or None), title


def _require_text(result: dict[str, Any]) -> None:
    if len((result.get("text") or "").strip()) < config.MIN_WEB_TEXT_CHARS:
        raise error(NO_TEXT)
