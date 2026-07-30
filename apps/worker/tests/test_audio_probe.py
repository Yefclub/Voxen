"""Testes da validação de áudio com ffprobe antes da transcrição (spec 046)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from src import audio_probe
from src.audio_probe import AudioValidationError, validate_audio_for_transcription


class _FakeProc:
    """Substituto de asyncio.subprocess.Process para mockar o ffprobe."""

    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, self._stderr

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode


class _HangingProc(_FakeProc):
    """ffprobe que nunca responde — exercita o caminho de timeout."""

    async def communicate(self) -> tuple[bytes, bytes]:
        await asyncio.sleep(10)
        return b"", b""


def _ffprobe_json(*, duration: str | None = "12.5", with_audio: bool = True) -> bytes:
    streams: list[dict[str, object]] = []
    if with_audio:
        stream: dict[str, object] = {"codec_type": "audio", "codec_name": "opus"}
        if duration is not None:
            stream["duration"] = duration
        streams.append(stream)
    else:
        streams.append({"codec_type": "video", "codec_name": "h264"})
    fmt: dict[str, object] = {}
    if duration is not None:
        fmt["duration"] = duration
    return json.dumps({"streams": streams, "format": fmt}).encode("utf-8")


def _patch_ffprobe(
    monkeypatch: pytest.MonkeyPatch,
    proc: _FakeProc | None = None,
    *,
    raises: type[BaseException] | None = None,
) -> None:
    async def _fake_exec(*_args: object, **_kwargs: object) -> _FakeProc:
        if raises is not None:
            raise raises()
        assert proc is not None
        return proc

    monkeypatch.setattr(audio_probe.asyncio, "create_subprocess_exec", _fake_exec)


def _write_audio(tmp_path: Path, size: int = 2048) -> Path:
    path = tmp_path / "audio.opus"
    path.write_bytes(b"\x00" * size)
    return path


async def test_valid_audio_passes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _write_audio(tmp_path)
    _patch_ffprobe(monkeypatch, _FakeProc(stdout=_ffprobe_json(duration="12.5")))
    # Não levanta — áudio válido.
    await validate_audio_for_transcription(path)


async def test_missing_file_fails_early(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    called = False

    async def _should_not_run(*_a: object, **_k: object) -> _FakeProc:
        nonlocal called
        called = True
        return _FakeProc()

    monkeypatch.setattr(audio_probe.asyncio, "create_subprocess_exec", _should_not_run)
    with pytest.raises(AudioValidationError, match="não encontrado"):
        await validate_audio_for_transcription(tmp_path / "ausente.opus")
    assert called is False  # ffprobe nem foi chamado


async def test_empty_file_fails_early(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _write_audio(tmp_path, size=0)
    called = False

    async def _should_not_run(*_a: object, **_k: object) -> _FakeProc:
        nonlocal called
        called = True
        return _FakeProc()

    monkeypatch.setattr(audio_probe.asyncio, "create_subprocess_exec", _should_not_run)
    with pytest.raises(AudioValidationError, match="vazio"):
        await validate_audio_for_transcription(path)
    assert called is False


async def test_too_large_file_fails_early(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _write_audio(tmp_path, size=10)
    monkeypatch.setattr(audio_probe, "MAX_AUDIO_BYTES", 5)
    called = False

    async def _should_not_run(*_a: object, **_k: object) -> _FakeProc:
        nonlocal called
        called = True
        return _FakeProc()

    monkeypatch.setattr(audio_probe.asyncio, "create_subprocess_exec", _should_not_run)
    with pytest.raises(AudioValidationError, match="grande demais"):
        await validate_audio_for_transcription(path)
    assert called is False


async def test_no_audio_stream_fails_early(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _write_audio(tmp_path)
    _patch_ffprobe(monkeypatch, _FakeProc(stdout=_ffprobe_json(with_audio=False)))
    with pytest.raises(AudioValidationError, match="faixa de áudio"):
        await validate_audio_for_transcription(path)


async def test_zero_duration_fails_early(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _write_audio(tmp_path)
    _patch_ffprobe(monkeypatch, _FakeProc(stdout=_ffprobe_json(duration="0")))
    with pytest.raises(AudioValidationError, match="duração zero"):
        await validate_audio_for_transcription(path)


async def test_missing_duration_fails_early(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _write_audio(tmp_path)
    _patch_ffprobe(monkeypatch, _FakeProc(stdout=_ffprobe_json(duration=None)))
    with pytest.raises(AudioValidationError, match="duração zero"):
        await validate_audio_for_transcription(path)


async def test_duration_exceeding_max_fails_early(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _write_audio(tmp_path)
    # MAX_DURATION_SEC = 4h = 14400s; 5h excede.
    _patch_ffprobe(monkeypatch, _FakeProc(stdout=_ffprobe_json(duration="18000")))
    with pytest.raises(AudioValidationError, match="duração máxima"):
        await validate_audio_for_transcription(path)


async def test_ffprobe_missing_degrades_gracefully(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _write_audio(tmp_path)
    _patch_ffprobe(monkeypatch, raises=FileNotFoundError)
    # ffprobe ausente → não bloqueia; segue sem erro.
    await validate_audio_for_transcription(path)


async def test_ffprobe_nonzero_exit_degrades_gracefully(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _write_audio(tmp_path)
    _patch_ffprobe(monkeypatch, _FakeProc(stderr=b"boom", returncode=1))
    # ffprobe falhou na execução → degrada graceful (deixa a API decidir).
    await validate_audio_for_transcription(path)


async def test_ffprobe_timeout_degrades_gracefully(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _write_audio(tmp_path)
    monkeypatch.setattr(audio_probe, "FFPROBE_TIMEOUT_SEC", 0.05)
    _patch_ffprobe(monkeypatch, _HangingProc())
    # ffprobe pendurado → timeout → None → degradação graceful (não levanta).
    await validate_audio_for_transcription(path)


async def test_ffprobe_invalid_json_degrades_gracefully(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _write_audio(tmp_path)
    _patch_ffprobe(monkeypatch, _FakeProc(stdout=b"not json at all"))
    await validate_audio_for_transcription(path)


async def test_pipeline_converts_validation_error_and_skips_api(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Integração: validação reprovada vira PermanentError e a API NÃO é chamada."""
    from unittest.mock import AsyncMock

    from src import pipeline

    monkeypatch.setattr(
        pipeline.voxen_settings,
        "get_openrouter_model_config",
        AsyncMock(
            return_value=pipeline.voxen_settings.OpenRouterModelConfig(
                api_key="sk-test",
                model="x-ai/grok-stt-1.0",
            )
        ),
    )

    split_called = False
    api_called = False

    async def _fake_split(*_a: object, **_k: object) -> list[object]:
        nonlocal split_called
        split_called = True
        return []

    async def _fake_transcribe(*_a: object, **_k: object) -> object:
        nonlocal api_called
        api_called = True
        raise AssertionError("transcribe_audio não deveria ser chamado")

    monkeypatch.setattr(pipeline, "split_audio", _fake_split)
    monkeypatch.setattr(pipeline, "transcribe_audio", _fake_transcribe)

    async def _fail_validation(_path: Path) -> None:
        raise AudioValidationError(
            "Áudio com duração zero ou indetectável — nada para transcrever."
        )

    monkeypatch.setattr(pipeline, "validate_audio_for_transcription", _fail_validation)

    log = AsyncMock()
    with pytest.raises(pipeline.PermanentError) as exc_info:
        await pipeline._transcribe_via_api(
            audio_path=tmp_path / "audio.opus",
            user_id="u1",
            job_id="j1",
            duration_sec=120,
            tmpdir=tmp_path,
            log=log,
        )
    assert exc_info.value.code == "AUDIO_VALIDATION_FAILED"
    assert (
        exc_info.value.public_message
        == "O áudio enviado não passou pela validação para transcrição."
    )
    assert "duração zero" not in exc_info.value.public_message
    assert split_called is False
    assert api_called is False
