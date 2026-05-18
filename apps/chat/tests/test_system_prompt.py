"""Testes pra build_system_prompt — injeção de variáveis de contexto IA."""

from __future__ import annotations

from src.main import build_system_prompt


def test_includes_user_name() -> None:
    out = build_system_prompt(user_name="Carlos", user_timezone="UTC")
    assert "Carlos" in out


def test_empty_name_falls_back_to_default() -> None:
    out = build_system_prompt(user_name="", user_timezone="UTC")
    assert "usuário" in out


def test_invalid_timezone_falls_back_to_utc() -> None:
    out = build_system_prompt(user_name="x", user_timezone="Mars/Olympus_Mons")
    assert "UTC" in out
    # Não deve crashar e deve gerar prompt completo
    assert "Vox" in out


def test_valid_timezone_renders() -> None:
    out = build_system_prompt(user_name="x", user_timezone="America/Sao_Paulo")
    assert "America/Sao_Paulo" in out


def test_vox_identity_present() -> None:
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    # Identidade feminina + nome
    assert "Vox" in out
    assert "IDENTIDADE" in out


def test_hitl_section_present() -> None:
    """O agente DEVE ter instrução sobre HITL no prompt — crítico pra
    segurança de ações modificadoras."""
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "request_user_confirmation" in out


def test_web_search_guideline_present() -> None:
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "web_search" in out
