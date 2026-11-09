import asyncio
from typing import Any

import pytest

from capture_worker import http, images, web
from capture_worker.errors import CaptureError

ARTICLE = (
    """<!doctype html><html lang="pt-BR"><head>
<title>Título do artigo</title>
<meta property="og:title" content="Título do artigo">
<meta property="og:image" content="https://cdn.example.com/og.jpg">
<meta name="author" content="Fulana de Tal">
<meta property="article:published_time" content="2026-10-01T12:00:00Z">
<meta property="og:site_name" content="Exemplo">
</head><body><nav>menu</nav><article><h1>Título do artigo</h1>"""
    + "".join(
        f"<p>Parágrafo {i} com conteúdo suficiente para a extração funcionar bem.</p>"
        for i in range(12)
    )
    + "</article><footer>rodapé</footer></body></html>"
)


def _run(coro):
    return asyncio.run(coro)


def _fake_fetch(body: bytes, ctype: str):
    async def fetch(url: str, **kwargs: Any) -> http.Fetched:
        return http.Fetched(url, 200, ctype, body)

    return fetch


def test_html_article(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    requested: list[Any] = []

    async def fake_images(sources, tmp_dir):
        requested.extend(sources)
        return []

    monkeypatch.setattr(http, "fetch", _fake_fetch(ARTICLE.encode(), "text/html; charset=utf-8"))
    monkeypatch.setattr(images, "download", fake_images)
    result = _run(web.extract("https://example.com/a", str(tmp_path)))
    assert result["platform"] == "web"
    assert result["extractor"] == "trafilatura"
    assert result["title"] == "Título do artigo"
    assert result["author"] == "Fulana de Tal"
    assert result["channel"] == "Exemplo"
    assert result["language"] == "pt"
    assert result["publishedAt"].startswith("2026-10-01")
    assert result["textKind"] == "page"
    assert "Parágrafo 11" in result["text"]
    assert "menu" not in result["text"]
    assert requested == [("og_image", "https://cdn.example.com/og.jpg")]
    assert "_og_image" not in result


def test_short_page_is_no_text(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    html = b"<html><body><p>tiny</p></body></html>"
    monkeypatch.setattr(http, "fetch", _fake_fetch(html, "text/html"))
    with pytest.raises(CaptureError) as caught:
        _run(web.extract("https://example.com/", str(tmp_path)))
    assert caught.value.code == "NO_TEXT"


def test_binary_content_is_unsupported(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(http, "fetch", _fake_fetch(b"\x00\x01", "application/zip"))
    with pytest.raises(CaptureError) as caught:
        _run(web.extract("https://example.com/f.zip", str(tmp_path)))
    assert caught.value.code == "UNSUPPORTED"


def _pdf_bytes(text: str) -> bytes:
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    stream = DecodedStreamObject()
    lines = " ".join(f"T* ({text} {i}) Tj" for i in range(20))
    stream.set_data(f"BT /F1 10 Tf 14 TL 40 760 Td {lines} ET".encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    writer.add_metadata({"/Title": "Relatorio"})
    import io

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_pdf_link_uses_pypdf(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    pdf = _pdf_bytes("Linha de texto do relatorio")
    monkeypatch.setattr(http, "fetch", _fake_fetch(pdf, "application/pdf"))
    result = _run(web.extract("https://example.com/r.pdf", str(tmp_path)))
    assert result["extractor"] == "pypdf"
    assert result["title"] == "Relatorio"
    assert "Linha de texto do relatorio 19" in result["text"]


def test_corrupt_pdf_is_unsupported(tmp_path) -> None:
    path = tmp_path / "bad.pdf"
    path.write_bytes(b"%PDF-1.7 garbage")
    with pytest.raises(CaptureError) as caught:
        web.pdf_text_from_path(str(path))
    assert caught.value.code == "UNSUPPORTED"


def test_parsing_runs_in_a_killable_child(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A parser that never returns must time out instead of freezing the loop."""
    from capture_worker import config

    monkeypatch.setattr(config, "PARSE_TIMEOUT_SEC", 1)
    monkeypatch.setattr(
        web, "_parse_command", lambda: [web.sys.executable, "-c", "import time; time.sleep(30)"]
    )
    with pytest.raises(CaptureError) as caught:
        _run(web.pdf_text_isolated(str(tmp_path / "x.pdf"), str(tmp_path)))
    assert caught.value.code == "TIMEOUT"
