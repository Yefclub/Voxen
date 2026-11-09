"""CPU-bound parsing in a killable child process.

pypdf and Trafilatura are synchronous: running them inside the server's event
loop would freeze every endpoint (including /health) and make step timeouts
unenforceable. The parent writes the input to tmpfs, runs
`python .../parse_child.py <kind> <path> [url]` through
`proc.run` (hard timeout, SIGKILL on expiry) and reads JSON from stdout.
"""

from __future__ import annotations

import json
import os
import sys

# Run by file path (no reliance on PYTHONPATH or an installed package). The
# script's own directory must not stay on sys.path: modules there such as
# `http.py` would shadow the standard library.
sys.path[0] = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv: list[str]) -> int:
    kind, path = argv[1], argv[2]
    from capture_worker import web  # noqa: PLC0415 - imported after the sys.path fix

    if kind == "pdf":
        text, title = web.pdf_text_from_path(path)
        payload: dict[str, object] = {"text": text, "title": title}
    elif kind == "html":
        url = argv[3]
        with open(path, "rb") as handle:
            body = handle.read()
        payload = web.parse_html(body, url)
    else:
        return 2
    sys.stdout.write(json.dumps(payload))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except Exception as exc:  # noqa: BLE001 - mapped by the parent from the exit code
        code = getattr(exc, "code", None)
        sys.stdout.write(json.dumps({"error": code if isinstance(code, str) else "UNSUPPORTED"}))
        raise SystemExit(3) from None
