"""Focused prompts for the LangGraph nodes.

Kept separate from ``ai/app/prompts.py`` (the legacy stack's giant rule
blocks) so the new graph can evolve its prompt surface independently.

Modules:
  * persona       — warm-tone copy and HIPAA / scope guardrails reused
                    verbatim from the existing prompts.py.
  * extract       — system prompt + schema for the extract node.
  * scenes        — one prompt per respond scene (ask_field, present_slots,
                    confirm_booking, post_booking, crisis, info_answer,
                    callback, etc.).
"""
from __future__ import annotations
