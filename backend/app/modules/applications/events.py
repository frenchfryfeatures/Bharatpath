"""applications - domain events

Apply, stages, withdraw, expiry, hire confirm.

Events this module emits through the transactional outbox. Consumers are
idempotent by event id.
"""

from __future__ import annotations

from typing import Final

MODULE: Final = "applications"

#: Payloads carry identifiers only -- consumers resolve them behind their own
#: guards. No name, phone, email or meeting link ever rides an event.
APPLICATION_SUBMITTED: Final = f"{MODULE}.application_submitted"
APPLICATION_WITHDRAWN: Final = f"{MODULE}.application_withdrawn"

#: Every employer move, one event per recorded stage. SRS 1.9.2: "Candidate
#: receives the configured notification" -- `notifications.domain.plan_for`
#: decides which stages tell them.
APPLICATION_STAGE_CHANGED: Final = f"{MODULE}.stage_changed"
INTERVIEW_SCHEDULED: Final = f"{MODULE}.interview_scheduled"
APPLICATION_EXPIRED: Final = f"{MODULE}.application_expired"

HIRE_PROPOSED: Final = f"{MODULE}.hire_proposed"
HIRE_DISPUTED: Final = f"{MODULE}.hire_disputed"
#: **The final hire event** (SRS 1.13.3): both sides have confirmed. What it is
#: eligible for -- placement analytics, and any billing -- hangs off this one
#: event. Billing is deliberately not built: the client has deferred it, and
#: the SRS says it "must not be assumed".
HIRE_CONFIRMED: Final = f"{MODULE}.hire_confirmed"

#: An employer wrote to an applicant (2026-09-29): an interview or assessment
#: invitation, or a message. Notifications emails and posts it in the app.
#: The payload carries the message id; the words are read at dispatch.
MESSAGE_SENT: Final = f"{MODULE}.message_sent"

#: An employer invited a candidate from search to a job (2026-10-05).
#: Notifications tells the candidate; the payload names ids only.
SHORTLIST_INVITED: Final = f"{MODULE}.shortlist_invited"
#: The candidate answered an invitation: ACCEPTED (an application now exists)
#: or DECLINED.
SHORTLIST_ANSWERED: Final = f"{MODULE}.shortlist_answered"
