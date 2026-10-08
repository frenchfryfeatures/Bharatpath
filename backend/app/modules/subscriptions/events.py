"""subscriptions - domain events

Plans, periods, renewal, cancellation, seats.

Events this module emits through the transactional outbox. Consumers are
idempotent by event id. Notifications is the consumer all three exist for.
"""

from __future__ import annotations

from typing import Final

MODULE: Final = "subscriptions"

#: Any change recorded in `subscription_events`, with `from_state`,
#: `to_state` and `reason` in the payload.
STATE_CHANGED: Final = f"{MODULE}.state_changed"

#: A mandate debit is coming. Our own message to the payer, alongside the
#: notice the gateway sends through their UPI app.
PRE_DEBIT_NOTIFIED: Final = f"{MODULE}.pre_debit_notified"

#: Auto-renew stopped without the subscriber asking -- a mandate revoked in
#: their UPI app, a price past the mandate's ceiling, or debits that kept
#: failing. **Sent while the period still has days in it**, so they can renew
#: by hand before access lapses.
FELL_BACK_TO_MANUAL: Final = f"{MODULE}.fell_back_to_manual"
