"""interview - domain events

Audio sessions, chunk upload, evaluation, +20/session.

Events this module emits through the transactional outbox. Consumers are
idempotent by event id.
"""

from __future__ import annotations

from typing import Final

MODULE: Final = "interview"

#: A session was completed: every answer stored. **Routed to scoring**
#: (`app/tasks/routing.py`), which re-scores from the stored extraction and
#: applies the +60 cap. This module imports nothing from `scoring`
#: (invariant 4'); scoring reads completions through
#: `interview.service.contributions_for`.
SESSION_COMPLETED: Final = f"{MODULE}.session_completed"

#: One answer's audio is stored. For the transcription pipeline.
ANSWER_STORED: Final = f"{MODULE}.answer_stored"

#: A completed session was evaluated, or could not be (`outcome`). Feedback
#: only: routed to nothing that scores. For notifications.
SESSION_EVALUATED: Final = f"{MODULE}.session_evaluated"
