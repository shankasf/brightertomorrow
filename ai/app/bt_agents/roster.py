"""Single source of truth for the therapist roster.

Only therapists in THERAPISTS_WITH_FEEDS have iCal calendar feeds wired
to the gateway, so AI-driven slot proposals and bookings are limited to
that pool. THERAPISTS_WITHOUT_FEEDS are still valid clinicians but must
be booked via callback (request_intake_callback) rather than self-service.
"""
from __future__ import annotations

THERAPISTS_WITH_FEEDS: list[dict] = [
    {"staffId": 71, "name": "Sagar Shankaran"},
    {"staffId": 47, "name": "Elisia Danley"},
    {"staffId": 24, "name": "Keunshea Fleming"},
    {"staffId": 21, "name": "Alayna Hammond"},
    {"staffId": 34, "name": "Christie Johnson"},
    {"staffId": 53, "name": "Janelle Thompson"},
]

# excluded from AI self-service booking — no iCal feed
THERAPISTS_WITHOUT_FEEDS: list[dict] = [
    {"staffId": 59, "name": "Samara Cobb"},    # excluded
    {"staffId": 16, "name": "Joanne Tran"},    # excluded
    {"staffId": 45, "name": "Jordan Fuller"},  # excluded
    {"staffId": 66, "name": "Monica Gonzalez"},# excluded
]

ELIGIBLE_FOR_BOOKING: list[dict] = THERAPISTS_WITH_FEEDS
