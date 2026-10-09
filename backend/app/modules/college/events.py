"""college - domain events

Institution tenant, roster, invites, consent, referral codes.

Events this module emits through the transactional outbox. Consumers are
idempotent by event id. **None carries a student's name or contact**: ids
only, resolved by a consumer entitled to read them.
"""

from __future__ import annotations

from typing import Final

MODULE: Final = "college"

ORGANISATION_CREATED: Final = f"{MODULE}.organisation_created"

#: A college's seat allowance changed, with how many waiting students it seated.
SEATS_ALLOCATED: Final = f"{MODULE}.seats_allocated"

#: A student linked to a college by code or invitation: a ROSTER consent was
#: granted. For analytics and notifications.
STUDENT_LINKED: Final = f"{MODULE}.student_linked"

ROSTER_IMPORT_COMMITTED: Final = f"{MODULE}.roster_import_committed"

#: A student let their college see them as a person (INDIVIDUAL scope).
INDIVIDUAL_VISIBILITY_GRANTED: Final = f"{MODULE}.individual_visibility_granted"

#: A student revoked consent (SRS 1.19.2: "Institution is notified of the
#: changed access state"). `scopes` lists what ended. **For a ROSTER
#: revocation the college-facing message must not name the student**: a
#: named "X disconnected" beside a dashboard that just changed is X's band.
CONSENT_REVOKED: Final = f"{MODULE}.consent_revoked"

#: One invitation to send. Notifications read the contact from the roster row
#: at dispatch; the payload carries ids only.
INVITATION_SENT: Final = f"{MODULE}.invitation_sent"
