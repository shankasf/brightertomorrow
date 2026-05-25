"""
email_template.py — THE single, central branded email template.

Every patient email (booking ack, appointment confirmed, approved/cancelled,
insurance, web-intake) is rendered HERE, in the one place each email flows
through (the notifications-retry Lambda). Producers (gateway Go + chat Python)
send only structured CONTENT — never HTML — so the look stays consistent:

    {
      "subject":    "...",
      "heading":    "...",
      "paragraphs": ["intro ...", "closing ..."],   # plain text, escaped here
      "details":    [["Therapist","Janelle ..."], ["When","Tue ..."]]  # optional
    }

Render order: first paragraph, then the highlighted details box (if any),
then the remaining paragraphs.

HIPAA: callers must already keep content minimum-necessary (no diagnosis /
insurance specifics / DOB / financial). This module only escapes + lays out.
"""
from __future__ import annotations

from html import escape
from typing import Any, Dict, List

# ── Brand constants (single source of truth for the look) ────────────────────
LOGO_URL = "https://brightertomorrowtherapy.cloud/brand/logo-email.png"  # white wordmark for the navy header
SITE_URL = "https://brightertomorrowtherapy.cloud"
PHONE_DISPLAY = "725-238-6990"
PHONE_HREF = "tel:7252386990"

C_NAVY = "#192735"     # header bg + headings
C_GOLD = "#E1B878"     # accent rule + CTA
C_BURGUNDY = "#66202A"  # links
C_TEAL = "#75ACC0"     # details accent
C_BODY = "#3a4a59"     # body text
C_MUTED = "#5a6878"
C_SOFT = "#858585"

FOOTER_TEXT = (
    "You're receiving this because you contacted Brighter Tomorrow Therapy. "
    "This message may contain health-related information; if it reached you in "
    "error, please delete it and let us know."
)
ADDR_1 = "3430 E Russell Rd Ste 315, Las Vegas, NV 89120"
ADDR_2 = "6955 N Durango Dr Unit 1004, Las Vegas, NV 89149"

_FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def _details_box(details: List[List[str]]) -> str:
    if not details:
        return ""
    rows = "<br>".join(
        f"<strong>{escape(str(label))}:</strong> {escape(str(value))}"
        for label, value in details
        if str(value).strip()
    )
    if not rows:
        return ""
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:4px 0 18px 0;background:#F4F4F4;border-left:4px solid {C_TEAL};'
        f'border-radius:8px;"><tr><td style="padding:16px 18px;font-size:15px;'
        f'line-height:1.8;color:{C_NAVY};">{rows}</td></tr></table>'
    )


def _paragraph(text: str) -> str:
    return (
        f'<p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:{C_BODY};">'
        f"{escape(text)}</p>"
    )


def render_html(heading: str, paragraphs: List[str], details: List[List[str]] | None = None) -> str:
    details = details or []
    paragraphs = paragraphs or []

    # first paragraph → details box → remaining paragraphs
    inner_parts: List[str] = []
    if paragraphs:
        inner_parts.append(_paragraph(paragraphs[0]))
    inner_parts.append(_details_box(details))
    for p in paragraphs[1:]:
        inner_parts.append(_paragraph(p))
    inner = "".join(inner_parts)

    return (
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        f'<body style="margin:0;padding:0;background:#F2F2F2;">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:#F2F2F2;padding:24px 12px;"><tr><td align="center">'
        f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        f'style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;'
        f'overflow:hidden;border:1px solid #E5E5E5;font-family:{_FONT};">'
        # header
        f'<tr><td style="background:{C_NAVY};padding:26px 32px;text-align:center;">'
        f'<img src="{LOGO_URL}" alt="Brighter Tomorrow Therapy" width="190" '
        f'style="display:block;margin:0 auto;width:190px;max-width:70%;height:auto;">'
        f'<p style="margin:10px 0 0 0;font-size:16px;font-weight:700;color:#ffffff;'
        f'font-family:{_FONT};text-align:center;">Brighter Tomorrow Therapy</p></td></tr>'
        # gold accent
        f'<tr><td style="height:4px;background:{C_GOLD};line-height:4px;font-size:0;">&nbsp;</td></tr>'
        # body
        f'<tr><td style="padding:34px 32px 6px 32px;">'
        f'<h1 style="margin:0 0 18px 0;font-size:21px;line-height:1.3;color:{C_NAVY};'
        f'font-weight:700;">{escape(heading)}</h1>{inner}</td></tr>'
        # CTA
        f'<tr><td style="padding:6px 32px 32px 32px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td style="border-radius:999px;background:{C_GOLD};">'
        f'<a href="{PHONE_HREF}" style="display:inline-block;padding:13px 28px;'
        f'font-size:15px;font-weight:600;color:{C_NAVY};text-decoration:none;'
        f'border-radius:999px;">Call us: {PHONE_DISPLAY}</a></td></tr></table></td></tr>'
        # footer
        f'<tr><td style="background:#F8F7F4;padding:22px 32px;border-top:1px solid #ECECEC;">'
        f'<p style="margin:0 0 10px 0;font-size:12px;line-height:1.6;color:{C_SOFT};">{escape(FOOTER_TEXT)}</p>'
        f'<p style="margin:0;font-size:12px;line-height:1.7;color:{C_MUTED};">'
        f'<strong style="color:{C_NAVY};">Brighter Tomorrow Therapy</strong><br>'
        f'{escape(ADDR_1)}<br>{escape(ADDR_2)}<br>'
        f'<a href="{SITE_URL}" style="color:{C_BURGUNDY};text-decoration:none;">'
        f'brightertomorrowtherapy.cloud</a></p></td></tr>'
        '</table></td></tr></table></body></html>'
    )


def render_text(heading: str, paragraphs: List[str], details: List[List[str]] | None = None) -> str:
    details = details or []
    paragraphs = paragraphs or []
    lines: List[str] = [heading, ""]
    if paragraphs:
        lines.append(paragraphs[0])
    for label, value in details:
        if str(value).strip():
            lines.append(f"  {label}: {value}")
    for p in paragraphs[1:]:
        lines.append("")
        lines.append(p)
    lines += ["", f"Call us: {PHONE_DISPLAY}", "", FOOTER_TEXT,
              "", "Brighter Tomorrow Therapy", ADDR_1, ADDR_2, SITE_URL]
    return "\n".join(lines)


def render_from_payload(body: Dict[str, Any]) -> tuple[str, str, str]:
    """Return (subject, html_body, text_body) for a structured content payload.

    Falls back to a pre-rendered html_body/text_body if a legacy producer sends
    those instead of structured fields.
    """
    subject = body.get("subject") or "Message from Brighter Tomorrow Therapy"
    if body.get("html_body"):  # legacy pre-rendered payload
        return subject, body["html_body"], body.get("text_body", "")
    heading = body.get("heading", "")
    paragraphs = body.get("paragraphs") or []
    details = body.get("details") or []
    return subject, render_html(heading, paragraphs, details), render_text(heading, paragraphs, details)
