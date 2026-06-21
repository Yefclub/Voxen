"""Testes do cookiefile do worker (yt-dlp cookies para extração autenticada)."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from src import ytdl
from src.ytdl import _cookiefile_opts

NETSCAPE = (
    "# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tsecret-token\n"
)


def test_cookiefile_opts_none_yields_empty() -> None:
    with _cookiefile_opts(None) as patch:
        assert patch == {}


def test_cookiefile_opts_blank_yields_empty() -> None:
    with _cookiefile_opts("   \n  ") as patch:
        assert patch == {}


def test_cookiefile_opts_writes_600_file_with_content() -> None:
    captured_path: str | None = None
    with _cookiefile_opts(NETSCAPE) as patch:
        captured_path = patch["cookiefile"]
        p = Path(captured_path)
        assert p.exists()
        # Permissão exatamente 0600 (sem grupo/outros).
        mode = stat.S_IMODE(os.stat(p).st_mode)
        assert mode == 0o600
        assert p.read_text(encoding="utf-8") == NETSCAPE
    # Lifecycle fechado: arquivo removido ao sair do contexto.
    assert captured_path is not None
    assert not Path(captured_path).exists()


def test_cookiefile_opts_appends_trailing_newline() -> None:
    with _cookiefile_opts("a\tb") as patch:
        assert Path(patch["cookiefile"]).read_text(encoding="utf-8").endswith("\n")


def test_cookiefile_opts_cleans_up_on_exception() -> None:
    captured_path: str | None = None
    with pytest.raises(RuntimeError):
        with _cookiefile_opts(NETSCAPE) as patch:
            captured_path = patch["cookiefile"]
            raise RuntimeError("boom")
    assert captured_path is not None
    assert not Path(captured_path).exists()


async def test_extract_info_sets_cookiefile_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ytdl.voxen_settings,
        "get_yt_dlp_cookies",
        AsyncMock(return_value=NETSCAPE),
    )
    seen: dict[str, object] = {}

    def fake_extract(url: str, opts: dict[str, object]) -> dict[str, object]:
        seen.update(opts)
        # O arquivo deve existir DURANTE a chamada.
        assert Path(str(opts["cookiefile"])).exists()
        return {"id": "x"}

    monkeypatch.setattr(ytdl, "_extract_info", fake_extract)
    await ytdl._extract_info_with_cookies("https://example.com", {"quiet": True})
    assert "cookiefile" in seen
    # Limpeza após a chamada.
    assert not Path(str(seen["cookiefile"])).exists()


async def test_extract_info_no_cookiefile_when_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ytdl.voxen_settings,
        "get_yt_dlp_cookies",
        AsyncMock(return_value=None),
    )
    seen: dict[str, object] = {}

    def fake_extract(url: str, opts: dict[str, object]) -> dict[str, object]:
        seen.update(opts)
        return {"id": "x"}

    monkeypatch.setattr(ytdl, "_extract_info", fake_extract)
    await ytdl._extract_info_with_cookies("https://example.com", {"quiet": True})
    assert "cookiefile" not in seen


async def test_download_sets_cookiefile_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ytdl.voxen_settings,
        "get_yt_dlp_cookies",
        AsyncMock(return_value=NETSCAPE),
    )
    seen: dict[str, object] = {}

    def fake_download(url: str, opts: dict[str, object]) -> None:
        seen.update(opts)

    monkeypatch.setattr(ytdl, "_run_download", fake_download)
    await ytdl._download_with_cookies("https://example.com", {"quiet": True})
    assert "cookiefile" in seen


async def test_download_no_cookiefile_when_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ytdl.voxen_settings,
        "get_yt_dlp_cookies",
        AsyncMock(return_value=None),
    )
    seen: dict[str, object] = {}

    def fake_download(url: str, opts: dict[str, object]) -> None:
        seen.update(opts)

    monkeypatch.setattr(ytdl, "_run_download", fake_download)
    await ytdl._download_with_cookies("https://example.com", {"quiet": True})
    assert "cookiefile" not in seen


def test_cookiefile_content_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    # O conteúdo do cookies (token secreto) NUNCA pode aparecer em logs.
    with caplog.at_level("DEBUG"):
        with _cookiefile_opts(NETSCAPE) as patch:
            assert "cookiefile" in patch
    assert "secret-token" not in caplog.text
    assert "sessionid" not in caplog.text
