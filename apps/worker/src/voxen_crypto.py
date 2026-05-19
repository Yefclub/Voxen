"""Voxen Master Key Crypto (Python).

AES-256-GCM autenticado para cifrar secrets que ficam em DB
(Settings.valueEnc — ver prisma/schema.prisma + .specs/000).

Formato do ciphertext (string base64 com 3 partes separadas por ponto):

    <iv_base64>.<ciphertext_base64>.<tag_base64>

- iv: 12 bytes aleatórios por mensagem
- ciphertext: AES-256-GCM(plaintext, key, iv) sem o tag
- tag: 16 bytes de authentication tag

Mesma codificação que `apps/web/src/lib/crypto.ts` — qualquer das 3 apps
decifra/cifra os mesmos blobs.
"""

from __future__ import annotations

import base64
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_LEN = 32  # 256 bits
IV_LEN = 12  # NIST SP 800-38D recommended
TAG_LEN = 16


class CryptoError(Exception):
    """Falha em qualquer operação criptográfica (formato, tampering, chave)."""


def encrypt(plaintext: str, key: bytes) -> str:
    """Cifra `plaintext` com `key` (32 bytes). Retorna `iv.ct.tag` em base64."""
    if len(key) != KEY_LEN:
        raise CryptoError(f"Master key must be {KEY_LEN} bytes, got {len(key)}")
    iv = secrets.token_bytes(IV_LEN)
    aesgcm = AESGCM(key)
    # cryptography lib concatena tag no final por padrão
    ct_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    ciphertext = ct_with_tag[:-TAG_LEN]
    tag = ct_with_tag[-TAG_LEN:]
    return ".".join(
        base64.b64encode(part).decode("ascii") for part in (iv, ciphertext, tag)
    )


def decrypt(encrypted: str, key: bytes) -> str:
    """Decifra string `iv.ct.tag` (base64) com `key`. Joga `CryptoError` em falha."""
    if len(key) != KEY_LEN:
        raise CryptoError(f"Master key must be {KEY_LEN} bytes, got {len(key)}")
    parts = encrypted.split(".")
    if len(parts) != 3:
        raise CryptoError(
            f"Invalid ciphertext format (expected 3 parts, got {len(parts)})"
        )
    try:
        iv = base64.b64decode(parts[0])
        ciphertext = base64.b64decode(parts[1])
        tag = base64.b64decode(parts[2])
    except Exception as exc:
        raise CryptoError("Invalid base64 in ciphertext parts") from exc
    if len(iv) != IV_LEN:
        raise CryptoError(f"Invalid iv length {len(iv)}, expected {IV_LEN}")
    if len(tag) != TAG_LEN:
        raise CryptoError(f"Invalid tag length {len(tag)}, expected {TAG_LEN}")
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
    except Exception as exc:
        raise CryptoError(f"Decryption failed: {exc}") from exc
    return plaintext.decode("utf-8")


def load_master_key(path: str | Path) -> bytes:
    """Carrega master key de `path` (base64 do raw 32 bytes, vide master-key-init.sh)."""
    p = Path(path)
    try:
        content = p.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise CryptoError(
            f"FATAL: master key not accessible at {path}: {exc}"
        ) from exc
    try:
        key = base64.b64decode(content)
    except Exception as exc:
        raise CryptoError(
            f"FATAL: master key at {path} is not valid base64"
        ) from exc
    if len(key) != KEY_LEN:
        raise CryptoError(
            f"Master key at {path} is {len(key)} bytes; expected {KEY_LEN}"
        )
    return key


def load_master_key_value(value: str, name: str = "MASTER_KEY") -> bytes:
    """Carrega master key direto de env var (base64 do raw 32 bytes)."""
    try:
        key = base64.b64decode(value.strip(), validate=True)
    except Exception as exc:
        raise CryptoError(f"FATAL: {name} is not valid base64") from exc
    if len(key) != KEY_LEN:
        raise CryptoError(f"FATAL: {name} must be base64-encoded {KEY_LEN} bytes")
    return key
