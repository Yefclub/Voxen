"""Tests for apps/worker voxen_crypto module.

Cobre roundtrip, error paths (tampering, formato, chave errada),
e load_master_key.
"""

from __future__ import annotations

import base64
import secrets
from pathlib import Path

import pytest

from src.voxen_crypto import (
    CryptoError,
    decrypt,
    encrypt,
    load_master_key,
    load_master_key_value,
)

KEY = secrets.token_bytes(32)


class TestRoundtrip:
    def test_ascii(self) -> None:
        msg = "hello voxen"
        assert decrypt(encrypt(msg, KEY), KEY) == msg

    def test_utf8(self) -> None:
        msg = "olá mundo 你好 — café com ñ"
        assert decrypt(encrypt(msg, KEY), KEY) == msg

    def test_empty(self) -> None:
        assert decrypt(encrypt("", KEY), KEY) == ""

    def test_large(self) -> None:
        msg = "a" * 10_000
        assert decrypt(encrypt(msg, KEY), KEY) == msg

    def test_random_iv(self) -> None:
        """Mesma mensagem produz ciphertext diferente (IV aleatório)."""
        a = encrypt("same", KEY)
        b = encrypt("same", KEY)
        assert a != b

    def test_format_3_parts(self) -> None:
        enc = encrypt("x", KEY)
        assert len(enc.split(".")) == 3


class TestDecryptErrors:
    def test_invalid_format_no_dots(self) -> None:
        with pytest.raises(CryptoError):
            decrypt("not_valid", KEY)

    def test_too_few_parts(self) -> None:
        with pytest.raises(CryptoError, match="Invalid ciphertext format"):
            decrypt("a.b", KEY)

    def test_tampered_ciphertext(self) -> None:
        enc = encrypt("hello", KEY)
        parts = enc.split(".")
        ct = bytearray(base64.b64decode(parts[1]))
        if ct:
            ct[0] ^= 0xFF
        parts[1] = base64.b64encode(bytes(ct)).decode()
        with pytest.raises(CryptoError):
            decrypt(".".join(parts), KEY)

    def test_wrong_key(self) -> None:
        enc = encrypt("hello", KEY)
        with pytest.raises(CryptoError):
            decrypt(enc, secrets.token_bytes(32))

    def test_invalid_iv_length(self) -> None:
        enc = encrypt("hello", KEY)
        parts = enc.split(".")
        parts[0] = base64.b64encode(b"short").decode()
        with pytest.raises(CryptoError, match="Invalid iv length"):
            decrypt(".".join(parts), KEY)


class TestKeySize:
    def test_short_key_rejected(self) -> None:
        with pytest.raises(CryptoError, match="32 bytes"):
            encrypt("hi", b"short")

    def test_long_key_rejected(self) -> None:
        with pytest.raises(CryptoError, match="32 bytes"):
            encrypt("hi", secrets.token_bytes(48))


class TestLoadMasterKey:
    def test_valid_key_from_file(self, tmp_path: Path) -> None:
        key = secrets.token_bytes(32)
        path = tmp_path / "master.key"
        path.write_text(base64.b64encode(key).decode())
        assert load_master_key(path) == key

    def test_missing_file(self) -> None:
        with pytest.raises(CryptoError, match="FATAL: master key not accessible"):
            load_master_key("/nonexistent/master.key")

    def test_wrong_size_key(self, tmp_path: Path) -> None:
        path = tmp_path / "master.key"
        path.write_text(base64.b64encode(b"only-16-bytes-xx").decode())
        with pytest.raises(CryptoError, match="bytes; expected 32"):
            load_master_key(path)

    def test_valid_key_from_env_value(self) -> None:
        key = secrets.token_bytes(32)
        assert load_master_key_value(base64.b64encode(key).decode()) == key

    def test_wrong_size_env_value(self) -> None:
        with pytest.raises(CryptoError, match="MASTER_KEY must be base64-encoded 32 bytes"):
            load_master_key_value(base64.b64encode(b"short").decode())


def test_cross_compat_format() -> None:
    """Documenta formato esperado p/ ser cross-compat com TS (apps/web)."""
    enc = encrypt("test", KEY)
    parts = enc.split(".")
    iv = base64.b64decode(parts[0])
    tag = base64.b64decode(parts[2])
    assert len(iv) == 12
    assert len(tag) == 16
    # ciphertext pode ter qualquer tamanho (igual ao plaintext em GCM)
    ct = base64.b64decode(parts[1])
    assert len(ct) == len("test")
