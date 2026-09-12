from __future__ import annotations

import json
import logging

import structlog

from src.logging_config import configure_logging


def test_worker_logs_are_single_line_json_with_runtime_context(capsys, monkeypatch) -> None:
    monkeypatch.setenv("VOXEN_VERSION", "0.14.6-dev.1")
    monkeypatch.setenv("VOXEN_GIT_SHA", "abc1234")
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    structlog.reset_defaults()
    configure_logging()

    structlog.get_logger("test").info("job-done", job_id="job-1")

    line = capsys.readouterr().out.strip()
    event = json.loads(line)
    assert event == {
        "event": "job-done",
        "git_sha": "abc1234",
        "job_id": "job-1",
        "level": "info",
        "service": "voxen-worker",
        "timestamp": event["timestamp"],
        "version": "0.14.6-dev.1",
    }


def test_stdlib_logs_never_serialize_dependency_messages(capsys) -> None:
    configure_logging()

    logging.getLogger("provider.client").warning("token=must-not-leak provider payload")

    line = capsys.readouterr().err.strip()
    assert "must-not-leak" not in line
    assert json.loads(line) == {
        "event": "stdlib-log",
        "level": "warning",
        "logger": "provider.client",
        "service": "voxen-worker",
        "timestamp": json.loads(line)["timestamp"],
    }
