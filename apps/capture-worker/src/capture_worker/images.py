"""Remote images (thumbnails, post photos, og:image), fetched through the proxy
and re-encoded to JPEG so the web only ever receives a known format."""

from __future__ import annotations

import logging
import os
import secrets

from . import config, http, media
from .errors import CaptureError

log = logging.getLogger("capture_worker.images")


async def download(
    urls: list[tuple[str, str]], tmp_dir: str, limit: int = config.MAX_IMAGES
) -> list[dict[str, object]]:
    """`urls` is a list of (kind, url); stops after `limit` successes.
    Failures are skipped, never fatal."""
    images: list[dict[str, object]] = []
    seen: set[str] = set()
    for kind, url in urls:
        if len(images) >= min(limit, config.MAX_IMAGES):
            break
        if not url or url in seen:
            continue
        seen.add(url)
        try:
            fetched = await http.fetch(url, max_bytes=config.MAX_IMAGE_SOURCE_BYTES)
        except CaptureError as exc:
            log.info("image skipped: %s", exc.code)
            continue
        if not fetched.body:
            continue
        path = os.path.join(tmp_dir, f"src_{secrets.token_hex(6)}")
        with open(path, "wb") as handle:
            handle.write(fetched.body)
        try:
            image = await media.to_jpeg(path, kind, tmp_dir)
        finally:
            if os.path.exists(path):
                os.remove(path)
        if image:
            images.append(image)
    return images
