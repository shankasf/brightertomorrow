"""Single source of truth for the therapist roster.

All therapists have iCal feeds wired to the gateway, so the entire
roster is eligible for AI-driven slot proposals and bookings.
(Christie Johnson left the practice 2026-05-27 and was removed.)
"""
from __future__ import annotations

THERAPISTS_WITH_FEEDS: list[dict] = [
    {"staffId": 71, "name": "Sagar Shankaran"},
    {"staffId": 47, "name": "Elisia Danley"},
    {"staffId": 24, "name": "Keunshea Fleming"},
    {"staffId": 21, "name": "Alayna Hammond"},
    {"staffId": 53, "name": "Janelle Thompson"},
    {"staffId": 59, "name": "Samara Cobb"},
    {"staffId": 16, "name": "Joanne Tran"},
    {"staffId": 45, "name": "Jordan Fuller"},
    {"staffId": 66, "name": "Monica Gonzalez"},
]

# Reserved for future clinicians without feeds; empty for now.
THERAPISTS_WITHOUT_FEEDS: list[dict] = []

ELIGIBLE_FOR_BOOKING: list[dict] = THERAPISTS_WITH_FEEDS
