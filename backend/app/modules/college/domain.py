"""college - pure domain logic

Institution tenant, roster, invites, consent, referral codes.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Four sets of rules live here**, each with a twin below the service where one
is needed (the baseline migration, Day 17):

  1. **Referral codes are credentials** (R16). Sixty bits from a CSPRNG, an
     alphabet with no look-alike characters, a mandatory expiry, revocable,
     rate-limited on entry. A code resolves to exactly one college and grants
     **ROSTER scope only**.
  2. **Consent is versioned.** A student consents to a stated text; the app
     sends the version it showed, and a stale one is refused rather than
     recorded as consent to words the student never saw.
  3. **A roster is previewed before it is committed** (SRS 2.25.3): malformed
     rows and duplicates -- inside the file, or already on the roster -- are
     identified first, and nothing is invited until the college commits.
  4. **Seats are a count the database holds.** A seat is one student's access,
     paid for by the college (C12), so the cap is not advisory.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Final, Literal

# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------
#: **Placeholder text, ours, not counsel's** -- like every flagged placeholder
#: in `CLAUDE.md`. Bump the version whenever the words change: a consent row
#: records which words the student agreed to.
CONSENT_VERSION: Final = "placeholder-1-2026-09-17"

#: What linking to a college means, as the app must show it before the student
#: enters a code or accepts an invitation. ROSTER only (PRD 3.8): individual
#: visibility is a separate grant that nothing on this path confers.
ROSTER_CONSENT_KEY: Final = "college.consent.roster"
ROSTER_CONSENT_TEXT: Final = (
    "Your college will be able to count you among its students on BharatPath, "
    "in totals and statistics that never name you. It will not see your name, "
    "your profile, your score or your applications unless you separately agree "
    "to that. You can disconnect at any time."
)

#: What seeing a student as a person means (Day 18). **A separate grant, made
#: separately** (PRD 3.8): nothing on the linking path offers it, and it is
#: versioned apart from the roster text because the two change independently.
#: Placeholder words, ours, not counsel's, like the roster text above.
#:
#: **Version 2 (2026-09-29) widens what is shown**, at the client's request:
#: the details given at sign-up (contact included), the CV, practice
#: interviews completed, course progress, and each application with its
#: stage. Those are served only to a college whose student agreed to these
#: words (`INDIVIDUAL_DETAILS_VERSIONS`); a student who agreed to version 1
#: keeps version 1's narrower view until they agree again.
INDIVIDUAL_CONSENT_VERSION: Final = "placeholder-2-2026-09-29"
INDIVIDUAL_CONSENT_KEY: Final = "college.consent.individual"
INDIVIDUAL_CONSENT_TEXT: Final = (
    "Your college will be able to see you by name: the details you gave "
    "BharatPath when you signed up, including your phone number, email, city "
    "and your answers to the profile questions; your CV; your current "
    "BharatPath score and band; how many practice interviews you have "
    "completed; your progress through BharatPath courses; the jobs you have "
    "applied to through BharatPath, with the stage each application has "
    "reached, how many you have been interviewed for, and the jobs you were "
    "hired into. It will not hear your practice interview recordings or see "
    "anything an employer wrote about you. Every time someone at your college opens your "
    "details it is recorded. You can turn this off at any time, and your "
    "college loses this view at once."
)
#: The INDIVIDUAL consent versions whose words name the details above. The
#: consent-joined reads that serve them (`college_student_details` and its
#: siblings, migration 0005) hold the same list in SQL, and a test keeps the
#: two equal.
INDIVIDUAL_DETAILS_VERSIONS: Final = frozenset({INDIVIDUAL_CONSENT_VERSION})

ROSTER: Final = "ROSTER"
INDIVIDUAL: Final = "INDIVIDUAL"
SCOPES: Final = (ROSTER, INDIVIDUAL)
StudentLinkState = Literal["LINKED", "INVITED", "CONSENT_PENDING"]
StudentStageFilter = Literal["ALL", "LINKED", "INVITED", "CONSENT_PENDING"]
GRANTED_VIA_REFERRAL_CODE: Final = "REFERRAL_CODE"
GRANTED_VIA_INVITE: Final = "INVITE"
#: INDIVIDUAL scope, granted by the student from their own settings. **The
#: only way INDIVIDUAL is ever granted, and the only thing granted this way**
#: (`ck_student_consents_scope_via`): a code or an invitation confers ROSTER,
#: and nothing but the student's separate act confers INDIVIDUAL.
GRANTED_VIA_DIRECT: Final = "DIRECT"
GRANTED_VIA: Final = (GRANTED_VIA_INVITE, GRANTED_VIA_REFERRAL_CODE, GRANTED_VIA_DIRECT)


def consent_terms(scope: str) -> tuple[str, str, str]:
    """`(version, key, text)` of the words a student agrees to for `scope`."""
    if scope == INDIVIDUAL:
        return INDIVIDUAL_CONSENT_VERSION, INDIVIDUAL_CONSENT_KEY, INDIVIDUAL_CONSENT_TEXT
    if scope == ROSTER:
        return CONSENT_VERSION, ROSTER_CONSENT_KEY, ROSTER_CONSENT_TEXT
    raise ValueError(f"unknown consent scope: {scope}")


def scopes_revoked_with(scope: str) -> tuple[str, ...]:
    """What revoking `scope` ends. **Disconnecting ends individual visibility
    too**: a college cannot see as a person someone it may no longer even
    count. Revoking INDIVIDUAL leaves the link, and the seat, alone.
    `revoke_individual_with_roster` is the database's copy of this rule."""
    return (ROSTER, INDIVIDUAL) if scope == ROSTER else (INDIVIDUAL,)


# ---------------------------------------------------------------------------
# Referral codes
# ---------------------------------------------------------------------------
#: Crockford's base32: digits and capitals without I, L, O or U. Someone reads
#: this code off a noticeboard and types it on a phone, so no two characters
#: may look alike. 32 symbols divides 256, so masking a byte is unbiased.
CODE_ALPHABET: Final = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
#: 12 symbols x 5 bits = 60 bits. At the entry limit below an attacker gets
#: ~260,000 guesses a year per account, against 10^18 codes.
CODE_LENGTH: Final = 12
CODE_RANDOM_BYTES: Final = CODE_LENGTH

DEFAULT_CODE_VALID_DAYS: Final = 90
MAX_CODE_VALID_DAYS: Final = 365
MAX_CODE_USES: Final = 10_000

#: Entry attempts. Wrong and right attempts both count: the limit is on
#: guessing, and a guesser does not know which of theirs were right.
LINK_ATTEMPTS_PER_USER_PER_HOUR: Final = 10
LINK_ATTEMPTS_PER_IP_PER_HOUR: Final = 30

#: Typed codes arrive with the confusions a person makes reading one aloud.
_LOOKALIKES: Final = str.maketrans({"O": "0", "I": "1", "L": "1"})


def code_from_bytes(random_bytes: bytes) -> str:
    """A code from CSPRNG output. The caller supplies the randomness, so this
    stays pure and a test can pin it."""
    if len(random_bytes) < CODE_LENGTH:
        raise ValueError(f"need {CODE_LENGTH} random bytes")
    return "".join(CODE_ALPHABET[b & 0x1F] for b in random_bytes[:CODE_LENGTH])


def normalise_code(raw: str) -> str | None:
    """What the student typed, as stored, or None if it cannot be a code.

    Case, spaces and hyphens are ignored, and O, I and L are read as 0, 1 and 1.
    Nothing else is forgiven: a wrong character is a wrong code.
    """
    cleaned = re.sub(r"[\s\-]", "", raw).upper().translate(_LOOKALIKES)
    if len(cleaned) != CODE_LENGTH or any(c not in CODE_ALPHABET for c in cleaned):
        return None
    return cleaned


def format_code(code: str) -> str:
    """`ABCD-EFGH-JKMN`, for printing. Stored without the hyphens."""
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def code_state(
    *,
    revoked_at: datetime | None,
    expires_at: datetime,
    uses: int,
    max_uses: int | None,
    now: datetime,
) -> str:
    """REVOKED, then EXPIRED, then EXHAUSTED, else ACTIVE. Revocation wins
    because it is a decision; the others are what time and use did."""
    if revoked_at is not None:
        return "REVOKED"
    if expires_at <= now:
        return "EXPIRED"
    if max_uses is not None and uses >= max_uses:
        return "EXHAUSTED"
    return "ACTIVE"


# ---------------------------------------------------------------------------
# Roster import
# ---------------------------------------------------------------------------
#: Bounded so a preview is one request, not a job: parsing and checking 5,000
#: rows is milliseconds. A larger cohort is split across files.
MAX_ROSTER_ROWS: Final = 5_000
MAX_ROSTER_BYTES: Final = 1_000_000
MAX_NAME_CHARS: Final = 200
MAX_STUDENT_REF_CHARS: Final = 64

#: The columns read, by header name, case-insensitive. **Contact and a name
#: only.** A roster column for a date of birth, a year of passing, a category
#: or a photograph is ignored and reported, never stored: the college's own
#: records are not ours to copy.
ROSTER_COLUMNS: Final = ("name", "phone", "email", "student_ref")

ROW_VALID: Final = "VALID"
ROW_INVALID: Final = "INVALID"
ROW_DUPLICATE: Final = "DUPLICATE"

#: Row issue codes, for the preview.
ISSUE_MISSING_CONTACT: Final = "missing_contact"
ISSUE_INVALID_PHONE: Final = "invalid_phone"
ISSUE_INVALID_EMAIL: Final = "invalid_email"
ISSUE_NAME_TOO_LONG: Final = "name_too_long"
ISSUE_STUDENT_REF_TOO_LONG: Final = "student_ref_too_long"
ISSUE_DUPLICATE_IN_FILE: Final = "duplicate_in_file"
ISSUE_ALREADY_ON_ROSTER: Final = "already_on_roster"

_EMAIL: Final = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RosterFileInvalid(ValueError):
    """The file as a whole cannot be previewed. `code` is for the app."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code


@dataclass(frozen=True, slots=True)
class RosterRow:
    #: 1-based, counting the header as row 1, so it matches a spreadsheet.
    row_number: int
    full_name: str | None
    phone: str | None
    email: str | None
    student_ref: str | None
    issues: tuple[str, ...] = ()

    @property
    def state(self) -> str:
        if any(i in (ISSUE_DUPLICATE_IN_FILE, ISSUE_ALREADY_ON_ROSTER) for i in self.issues):
            return ROW_DUPLICATE
        return ROW_INVALID if self.issues else ROW_VALID


@dataclass(frozen=True, slots=True)
class ParsedRoster:
    rows: tuple[RosterRow, ...]
    ignored_columns: tuple[str, ...] = field(default_factory=tuple)


def roster_fingerprint(text: str) -> str:
    """Identifies a file for idempotent upload. Line endings are ignored, so
    the same sheet exported on Windows and on a Mac is the same import."""
    return hashlib.sha256(text.replace("\r\n", "\n").strip().encode()).hexdigest()


def normalise_indian_mobile(raw: str) -> str | None:
    """`+91` and ten digits starting 6-9, from the ways a sheet writes one:
    spaces, hyphens, a leading 0, 91 or +91. Anything else is not a mobile."""
    digits = re.sub(r"[\s\-().]", "", raw)
    if digits.startswith("+91"):
        digits = digits[3:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if re.fullmatch(r"[6-9][0-9]{9}", digits) is None:
        return None
    return f"+91{digits}"


def normalise_email(raw: str) -> str | None:
    value = raw.strip().lower()
    return value if len(value) <= 320 and _EMAIL.match(value) else None


def parse_roster_csv(text: str) -> ParsedRoster:
    """Read a roster file into rows, each with its own issues.

    File-level problems raise `RosterFileInvalid` and nothing is previewed:
    too large, no header, no contact column, no rows, too many rows. Row-level
    problems never raise; they are what the preview is for.

    Duplicates inside the file are marked here, on the normalised contact: the
    second `98765 43210` is the same student as `+919876543210`. The first
    occurrence stays valid.
    """
    if len(text.encode()) > MAX_ROSTER_BYTES:
        raise RosterFileInvalid("roster_too_large", f"at most {MAX_ROSTER_BYTES} bytes")
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    try:
        header = next(reader)
    except StopIteration:
        raise RosterFileInvalid("roster_empty") from None
    except csv.Error as exc:
        raise RosterFileInvalid("roster_unreadable", str(exc)) from exc

    names = [h.strip().lower() for h in header]
    if "phone" not in names and "email" not in names:
        raise RosterFileInvalid("roster_no_contact_column", "a phone or email column is required")
    index: dict[str, int] = {n: names.index(n) for n in ROSTER_COLUMNS if n in names}
    ignored = tuple(sorted({h for h in names if h and h not in ROSTER_COLUMNS}))

    rows: list[RosterRow] = []
    seen_phones: set[str] = set()
    seen_emails: set[str] = set()
    try:
        for line_number, cells in enumerate(reader, start=2):
            if not any(cell.strip() for cell in cells):
                continue
            if len(rows) >= MAX_ROSTER_ROWS:
                raise RosterFileInvalid("roster_too_many_rows", f"at most {MAX_ROSTER_ROWS} rows")

            def cell(name: str, cells: list[str] = cells) -> str:
                position = index.get(name)
                if position is None or position >= len(cells):
                    return ""
                return cells[position].strip()

            issues: list[str] = []
            raw_phone, raw_email = cell("phone"), cell("email")
            phone = normalise_indian_mobile(raw_phone) if raw_phone else None
            email = normalise_email(raw_email) if raw_email else None
            if raw_phone and phone is None:
                issues.append(ISSUE_INVALID_PHONE)
            if raw_email and email is None:
                issues.append(ISSUE_INVALID_EMAIL)
            if not raw_phone and not raw_email:
                issues.append(ISSUE_MISSING_CONTACT)
            name = cell("name") or None
            if name is not None and len(name) > MAX_NAME_CHARS:
                issues.append(ISSUE_NAME_TOO_LONG)
            ref = cell("student_ref") or None
            if ref is not None and len(ref) > MAX_STUDENT_REF_CHARS:
                issues.append(ISSUE_STUDENT_REF_TOO_LONG)

            if not issues and (
                (phone is not None and phone in seen_phones)
                or (email is not None and email in seen_emails)
            ):
                issues.append(ISSUE_DUPLICATE_IN_FILE)
            if not issues:
                if phone is not None:
                    seen_phones.add(phone)
                if email is not None:
                    seen_emails.add(email)

            rows.append(RosterRow(line_number, name, phone, email, ref, tuple(issues)))
    except csv.Error as exc:
        raise RosterFileInvalid("roster_unreadable", str(exc)) from exc

    if not rows:
        raise RosterFileInvalid("roster_empty")
    return ParsedRoster(tuple(rows), ignored)


def mark_already_on_roster(
    rows: tuple[RosterRow, ...], *, phones: frozenset[str], emails: frozenset[str]
) -> tuple[RosterRow, ...]:
    """Mark valid rows whose contact is already on this college's committed
    roster. `phones` and `emails` are the committed ones, normalised."""
    return tuple(
        replace(row, issues=(*row.issues, ISSUE_ALREADY_ON_ROSTER))
        if row.state == ROW_VALID
        and (
            (row.phone is not None and row.phone in phones)
            or (row.email is not None and row.email in emails)
        )
        else row
        for row in rows
    )


# ---------------------------------------------------------------------------
# Invitations
# ---------------------------------------------------------------------------
#: An invitation not answered in this long is EXPIRED. Measured from when it
#: was sent, at read, like application expiry -- no sweep has to run for a
#: stale invitation to stop working.
INVITATION_VALID_FOR: Final = timedelta(days=30)

#: `roster_entries.invite_state`. NULL is a previewed row not yet committed.
INVITE_PENDING: Final = "PENDING"
INVITE_SENT: Final = "SENT"
INVITE_ACCEPTED: Final = "ACCEPTED"
INVITE_DECLINED: Final = "DECLINED"
INVITE_EXPIRED: Final = "EXPIRED"


#: `from -> to`, with NONE for a row not yet committed. Compiled into
#: `guard_roster_entry_write`. EXPIRED is never stored: it is read from the
#: clock, so a late answer is refused without a sweep having run.
INVITE_TRANSITIONS: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ("NONE", INVITE_PENDING),
        (INVITE_PENDING, INVITE_SENT),
        (INVITE_SENT, INVITE_ACCEPTED),
        (INVITE_SENT, INVITE_DECLINED),
    }
)


def invitation_state(*, stored: str | None, sent_at: datetime | None, now: datetime) -> str | None:
    """The state a reader sees: a SENT invitation past its period is EXPIRED."""
    if stored == INVITE_SENT and sent_at is not None and now >= sent_at + INVITATION_VALID_FOR:
        return INVITE_EXPIRED
    return stored


# ---------------------------------------------------------------------------
# Seats
# ---------------------------------------------------------------------------
def seats_available(*, allocated: int, used: int) -> int:
    return max(0, allocated - used)


def allocation_refusal(*, requested: int, used: int, plan_allowance: int | None) -> str | None:
    """Why an allocation is refused, or None.

    Never below what is in use: taking a seat from a student is a release, a
    decision about a person, and not a side effect of editing a number. Never
    above what the college's live plan pays for (C12: an over-allocated seat
    is a full subscription given away), and never without a live plan at all.
    """
    if requested < 0:
        return "college_seats_negative"
    if requested < used:
        return "college_seats_below_used"
    if requested > 0 and plan_allowance is None:
        return "college_seats_no_plan"
    if plan_allowance is not None and requested > plan_allowance:
        return "college_seats_exceed_plan"
    return None
