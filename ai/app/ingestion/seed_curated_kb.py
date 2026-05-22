"""Seed bt.kb_documents with curated, authoritative practice content.

WHY: The web crawler (ingest.py, now removed from the deploy pipeline)
populated kb_documents from the legacy .com blog only. That coverage is
fine for content-marketing questions ("how do I cope with anxiety?")
but has NO entries for the .cloud site's rates page, accepted-carriers
list, or the new-client booking process. The result is a "search_kb
returns 0 useful rows" failure mode where the info_answer scene falls
back to "I don't have that detail" — observed live on chat session
c291a8a7-…543 (2026-05-21) for rates/insurance/booking questions.

This script writes a small set of curated documents straight to
kb_documents with fresh embeddings, so the existing search_kb action
will rank them at the top for those queries. Re-runnable: each row is
keyed by source_hash so re-running upserts in place.

Sources:
  * Session rates / fees           — web/src/app/rates/page.tsx
  * Accepted insurance carriers    — web/src/app/rates/page.tsx CARRIERS[]
  * Out-of-network reimbursement   — web/src/app/rates/page.tsx (sec 3)
  * How to book as a new client    — web/src/app/contact/page.tsx + flow design
  * Office hours                   — site footer + ChatWidget prompts
  * Office locations               — web/src/app/our-story/page.tsx (footer addresses)
  * Telehealth availability        — multiple pages

PHI: none. These are practice marketing facts — safe to embed plaintext.
"""
from __future__ import annotations

import hashlib
import logging
import os
import sys
from dataclasses import dataclass

from openai import OpenAI

from ..core.db import conn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
URL_PREFIX = "curated://bt"  # synthetic URL so admin can tell these apart from crawled pages


@dataclass(frozen=True)
class Doc:
    slug: str
    title: str
    section: str
    content: str

    @property
    def url(self) -> str:
        return f"{URL_PREFIX}/{self.slug}"

    @property
    def source_hash(self) -> str:
        return hashlib.sha256(
            f"{self.url}\n{self.title}\n{self.section}\n{self.content}".encode("utf-8")
        ).hexdigest()


DOCS: tuple[Doc, ...] = (
    Doc(
        slug="rates",
        title="Session rates and fees",
        section="rates",
        content=(
            "Brighter Tomorrow Therapy session rates (cash-pay, HSA, and FSA accepted):\n"
            "\n"
            "Individual Therapy (50-minute session):\n"
            "  - Licensed therapist: $150\n"
            "  - Pre-licensed master's level clinician: $125\n"
            "  - Master's-level student therapist: $25 to $60 (pay-what-you-can)\n"
            "\n"
            "Couples Therapy:\n"
            "  - Licensed therapist, 50 minutes: $180\n"
            "  - Licensed therapist, 75 minutes: $260\n"
            "  - Pre-licensed master's level, 50 minutes: $150\n"
            "  - Pre-licensed master's level, 75 minutes: $225\n"
            "\n"
            "Life Coaching (50-minute session): $75. Six-session package: $440 (valid 3 months).\n"
            "\n"
            "Individual Therapy packages:\n"
            "  - 5 sessions: $150 total credit\n"
            "  - 10 sessions: $250 total credit\n"
            "  Valid 6 months from purchase.\n"
            "\n"
            "Payment methods: HSA and FSA cards accepted alongside major credit cards.\n"
            "\n"
            "Affordable-therapy program: sessions available from $25 through master's-level "
            "student therapists in supervised practice. Visit the practice or call "
            "725-238-6990 for sliding-scale enrollment.\n"
            "\n"
            "Good Faith Estimate: under the federal No Surprises Act, patients may request "
            "a cost estimate in advance. If your bill exceeds the estimate by $400 or more, "
            "you may dispute it (www.cms.gov/nosurprises, 1-800-985-3059)."
        ),
    ),
    Doc(
        slug="accepted-insurance",
        title="Accepted insurance carriers",
        section="insurance",
        content=(
            "Brighter Tomorrow Therapy is in-network with the following carriers:\n"
            "  - Anthem Blue Cross Blue Shield\n"
            "  - Cigna\n"
            "  - United Healthcare (UHC)\n"
            "  - Ambetter / Silver Summit Health Plans\n"
            "  - Health Plan of Nevada\n"
            "  - Aetna\n"
            "\n"
            "If you don't see your carrier, most plans cover a significant portion of "
            "out-of-network behavioral health services; the practice provides monthly "
            "invoices for self-submitted reimbursement.\n"
            "\n"
            "Verifying benefits before your first session: bring your insurance card to "
            "intake, or share your member ID up front and the practice will run an "
            "eligibility check. You can also self-pay (see rates) or use HSA/FSA.\n"
            "\n"
            "Questions about coverage: call 725-238-6990 or email "
            "admin@brightertomorrowtherapy.com."
        ),
    ),
    Doc(
        slug="out-of-network",
        title="Out-of-network reimbursement",
        section="insurance",
        content=(
            "Don't see your carrier on the in-network list? Most insurance plans cover a "
            "significant portion of the cost of out-of-network behavioral health services. "
            "Brighter Tomorrow Therapy provides monthly invoices that clients can submit "
            "to their insurer for reimbursement.\n"
            "\n"
            "Before submitting, call your insurer and ask three questions:\n"
            "  1. What percentage of out-of-network mental-health visits is reimbursed?\n"
            "  2. Is there an out-of-network deductible, and how much of it has been met?\n"
            "  3. How do I submit a superbill / monthly invoice for reimbursement?\n"
            "\n"
            "Questions: 725-238-6990 or admin@brightertomorrowtherapy.com."
        ),
    ),
    Doc(
        slug="how-to-book",
        title="How to book an appointment as a new client",
        section="booking",
        content=(
            "Booking as a new client at Brighter Tomorrow Therapy is straightforward — you "
            "can do it directly in this chat, by phone, or through the contact form.\n"
            "\n"
            "Option 1 — book directly in the chat:\n"
            "  Tell the assistant 'I'd like to book' (or 'schedule me'). It will collect a "
            "  few quick details: your first and last name, date of birth, your insurance "
            "  payer and member ID (or choose self-pay), a phone number and email so the "
            "  practice can reach you, and a brief note on what you'd like support with. "
            "  Then it offers available appointment slots and confirms with you.\n"
            "\n"
            "Option 2 — call the practice:\n"
            "  Phone 725-238-6990 during business hours and the team will walk you through "
            "  intake and find a slot that fits.\n"
            "\n"
            "Option 3 — request a callback:\n"
            "  Tell the assistant 'have someone call me back' and leave a name + phone "
            "  number. A team member will reach out the same business day.\n"
            "\n"
            "What to expect on a first visit: a 50-minute session focused on understanding "
            "your goals and matching you with the right ongoing therapist. Bring your "
            "insurance card if you're using benefits.\n"
            "\n"
            "Email for non-urgent questions: admin@brightertomorrowtherapy.com."
        ),
    ),
    Doc(
        slug="hours",
        title="Office hours and customer service hours",
        section="practice-info",
        content=(
            "Brighter Tomorrow Therapy hours:\n"
            "  - Monday to Friday: 9:00 AM to 8:00 PM (clinical sessions)\n"
            "  - Saturday and Sunday: 10:00 AM to 4:00 PM (clinical sessions)\n"
            "  - Customer service / front desk: Monday to Friday 9:00 AM to 5:00 PM\n"
            "\n"
            "Phone: 725-238-6990. For non-urgent questions outside business hours, email "
            "admin@brightertomorrowtherapy.com and the team will reply the next business "
            "day. After-hours crisis support: 988 Suicide & Crisis Lifeline (call or text), "
            "or 911 for immediate danger."
        ),
    ),
    Doc(
        slug="locations",
        title="Office locations and telehealth",
        section="practice-info",
        content=(
            "Brighter Tomorrow Therapy serves clients across Nevada through two physical "
            "offices and statewide telehealth:\n"
            "\n"
            "  - E Russell Office: 3430 E Russell Rd Ste 315, Las Vegas, NV 89120\n"
            "  - N Durango Office: 6955 N Durango Dr Unit 1004, Las Vegas, NV 89149\n"
            "  - Telehealth: secure HIPAA-compliant video sessions, available anywhere in "
            "    Nevada.\n"
            "\n"
            "Clinicians are licensed in Nevada; telehealth across state lines is a "
            "licensure violation, so sessions are limited to clients physically located in "
            "Nevada at the time of the appointment. Mid-session moves out of state require "
            "us to pause care."
        ),
    ),
    Doc(
        slug="telehealth",
        title="Telehealth (virtual sessions)",
        section="practice-info",
        content=(
            "Telehealth at Brighter Tomorrow Therapy uses secure, HIPAA-compliant video "
            "and is available anywhere in Nevada. Sessions are the same 50-minute format "
            "as in-person, and most carriers cover telehealth at parity with in-person "
            "visits.\n"
            "\n"
            "Telehealth is a good fit for clients who:\n"
            "  - live outside Las Vegas / Henderson but still in Nevada\n"
            "  - have mobility, transportation, or scheduling constraints\n"
            "  - prefer the privacy of attending from home\n"
            "\n"
            "Licensure note: Nevada-only. If you'll be traveling out of state during a "
            "session window, mention it during booking and the team will work around it."
        ),
    ),
)


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


def seed_kb() -> int:
    """Insert/update curated documents with embeddings. Returns count."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.error("OPENAI_API_KEY not set")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    texts = [f"{d.title}\n{d.section}\n{d.content}" for d in DOCS]
    logger.info("Embedding %d curated KB documents using %s", len(DOCS), EMBED_MODEL)
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    vecs = [item.embedding for item in resp.data]

    with conn() as c, c.cursor() as cur:
        for doc, vec in zip(DOCS, vecs):
            cur.execute(
                """
                INSERT INTO bt.kb_documents
                    (url, title, section, chunk_idx, content, token_count, embedding, source_hash)
                VALUES
                    (%s, %s, %s, 0, %s, %s, %s::vector, %s)
                ON CONFLICT (source_hash) DO UPDATE SET
                    url = EXCLUDED.url,
                    title = EXCLUDED.title,
                    section = EXCLUDED.section,
                    content = EXCLUDED.content,
                    token_count = EXCLUDED.token_count,
                    embedding = EXCLUDED.embedding
                """,
                (
                    doc.url,
                    doc.title,
                    doc.section,
                    doc.content,
                    len(doc.content) // 4,  # rough token estimate
                    _vec_literal(vec),
                    doc.source_hash,
                ),
            )
    logger.info("Seeded %d curated KB documents", len(DOCS))
    return len(DOCS)


if __name__ == "__main__":
    n = seed_kb()
    sys.exit(0 if n > 0 else 1)
