"""Testes pra build_system_prompt + build_reasoning_config — qualidade do agente."""

from __future__ import annotations

from src.main import build_reasoning_config, build_system_prompt


def test_includes_user_name() -> None:
    out = build_system_prompt(user_name="Carlos", user_timezone="UTC")
    assert "Carlos" in out


def test_empty_name_falls_back_to_default() -> None:
    out = build_system_prompt(user_name="", user_timezone="UTC")
    assert "usuário" in out


def test_invalid_timezone_falls_back_to_utc() -> None:
    out = build_system_prompt(user_name="x", user_timezone="Mars/Olympus_Mons")
    assert "UTC" in out
    assert "Vox" in out


def test_valid_timezone_renders() -> None:
    out = build_system_prompt(user_name="x", user_timezone="America/Sao_Paulo")
    assert "America/Sao_Paulo" in out


def test_vox_identity_present() -> None:
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "Vox" in out
    assert "QUEM VOCÊ É" in out


def test_hitl_section_present() -> None:
    """Instrução de HITL é crítica pra segurança de ações modificadoras."""
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "request_user_confirmation" in out


def test_web_search_guideline_present() -> None:
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "web_search" in out


def test_web_search_is_proactive() -> None:
    """O prompt antigo tratava web_search como último recurso; o novo manda usar
    proativamente. Sem isso a IA fica 'burra' em pesquisas (feedback do owner)."""
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "POR CONTA PRÓPRIA" in out


def test_no_over_restriction() -> None:
    """A regra antiga 'Responda EXCLUSIVAMENTE com base nas tools... Nunca invente'
    matava a conversa — não deve voltar."""
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "EXCLUSIVAMENTE" not in out


def test_partner_framing_present() -> None:
    """O agente deve ser enquadrado como parceiro de conversa, não tool-caller."""
    out = build_system_prompt(user_name="x", user_timezone="UTC")
    assert "PARCEIRA DE PENSAMENTO" in out


def test_reasoning_always_on() -> None:
    """Reasoning sempre ligado (decisão do owner); o toggle só aprofunda o esforço."""
    off = build_reasoning_config(thinking=False)
    on = build_reasoning_config(thinking=True)
    assert off["enabled"] is True
    assert on["enabled"] is True
    assert off["effort"] == "medium"
    assert on["effort"] == "high"
    assert off["exclude"] is False
