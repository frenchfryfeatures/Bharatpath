"""Message templates, and the DLT registration each SMS one still needs.

**No SMS is sent today, by the client's decision of 2026-09-18.** Phone OTP
and every SMS notification are deferred until the organisation's registration
exists, and with it DLT and a sender. Everything a person is told goes by
email and to the in-app inbox: `domain.plan_for` names no SMS template, and
`tests/unit/test_notifications_domain.py` fails the build if one reappears.
The SMS drafts below are kept, unregistered, so that switching SMS back on is
a registration and a routing change rather than a rewrite.

**Writing the words is the easy half.** Every SMS body below must be registered
on a TRAI DLT portal against the client's registered entity and sender header
before a single message reaches an Indian number. Registration returns a
template id, and an SMS sent with an unregistered or mismatched body is
*silently dropped by the operator* -- no error to us, no message to the user.
That is why `dlt_template_id` is a required field that is `None` on every row
here, and why `is_dlt_ready()` exists: sending is gated on it rather than on
somebody remembering.

DLT registration takes 2-4 weeks (blocker D1, started 2026-09-11). These drafts
exist so that registration can begin now rather than after the templates are
needed.

---

**Two length limits, and the second one is the one that hurts.**

A GSM-7 message is 160 characters. The moment a message contains one character
outside that alphabet -- which is every character of Hindi, Bengali, Tamil and
the rest -- the whole message switches to UCS-2 and the limit becomes **70
characters**, then 67 per part for a longer one. So the same message costs one
segment in English and three in Hindi.

`MAX_UNICODE_SEGMENT` is not decoration: a two-line English draft that reads
comfortably becomes a four-part Hindi message that costs four times as much and
arrives split. Every body below is drafted short enough to survive translation,
and there is a test asserting the English source stays within budget.

**Variables are capped at 30 characters by DLT.** A name longer than that must
be truncated before substitution, not by the operator.

---

**What is never put in a message.**

- **The score.** It sits behind a subscription (R5/R13), and an SMS is readable
  by anyone holding the phone. "Your score is 842" on a lock screen defeats
  both the paywall and the privacy.
- **Any financial framing.** Invariant 6, and `scripts/check_vocabulary.py`
  scans this file like every other.
- **Who viewed a candidate's profile, by name.** That is an employer's data in
  a candidate's message.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

TEMPLATES_VERSION: Final = "placeholder-3-2026-09-18"

#: GSM-7 single segment.
MAX_GSM_SEGMENT: Final = 160
#: UCS-2 single segment -- what every Indian-language message is measured
#: against.
MAX_UNICODE_SEGMENT: Final = 70
#: DLT caps each substituted variable.
MAX_VARIABLE_CHARS: Final = 30

#: Budget for an English source string. Deliberately tighter than 160: the
#: translation is usually longer than the English, and it is being measured
#: against 70.
MAX_SOURCE_CHARS: Final = 130

Channel = Literal["SMS", "EMAIL", "PUSH", "IN_APP"]

#: DLT categories. Getting this wrong is not cosmetic -- a promotional message
#: sent as transactional is a compliance breach, and a transactional message
#: registered as promotional is blocked by DND registration, which most Indian
#: numbers have.
DltCategory = Literal["SERVICE_IMPLICIT", "SERVICE_EXPLICIT", "TRANSACTIONAL", "PROMOTIONAL"]


@dataclass(frozen=True, slots=True)
class MessageTemplate:
    code: str
    channel: Channel
    #: Translation key. The `body` below is the English source and the
    #: fallback; the sent message comes from the locale bundle.
    key: str
    #: `{name}` style placeholders. Rendered to DLT's `{#var#}` form by
    #: `to_dlt_body` at registration time.
    body: str
    variables: tuple[str, ...] = ()
    dlt_category: DltCategory | None = None
    #: Filled in from the DLT portal once the template is approved. Until then
    #: the message cannot be sent.
    dlt_template_id: str | None = None
    subject: str | None = None  # EMAIL only


def to_dlt_body(template: MessageTemplate) -> str:
    """The body in the form the DLT portal expects: every variable as `{#var#}`.

    The portal matches the *sent* message against the registered body with
    variables substituted, so the two must differ in nothing but the variables.
    Generating the registration text from the same string we send is what stops
    them drifting apart.
    """
    body = template.body
    for name in template.variables:
        body = body.replace("{" + name + "}", "{#var#}")
    return body


def is_dlt_ready(template: MessageTemplate) -> bool:
    """SMS may only be sent once its template id is known. Non-SMS is exempt."""
    return template.channel != "SMS" or template.dlt_template_id is not None


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
# The OTP messages are the ones that must work first: without them nobody can
# sign in at all. They are SERVICE_IMPLICIT, which is the category that reaches
# a DND-registered number -- an OTP registered as promotional silently fails for
# most of the market.
#
# Each says what the code is for. A bare "Your OTP is 123456" is exactly what a
# fraudster asks a victim to read out; naming the action gives the victim the
# one sentence that might stop them.

AUTH_TEMPLATES: Final[tuple[MessageTemplate, ...]] = (
    MessageTemplate(
        "SMS_LOGIN_OTP",
        "SMS",
        "sms.login_otp",
        "{code} is your BharatPath sign-in code. It expires in {minutes} minutes. "
        "Do not share it with anyone.",
        ("code", "minutes"),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_PHONE_VERIFY_OTP",
        "SMS",
        "sms.phone_verify_otp",
        "{code} is your BharatPath code to confirm this mobile number. "
        "Do not share it with anyone.",
        ("code",),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_NEW_DEVICE",
        "SMS",
        "sms.new_device",
        "Your BharatPath account was opened on a new device. "
        "If this was not you, sign in and change your password.",
        (),
        "SERVICE_IMPLICIT",
    ),
)

# ---------------------------------------------------------------------------
# Candidate lifecycle
# ---------------------------------------------------------------------------

CANDIDATE_TEMPLATES: Final[tuple[MessageTemplate, ...]] = (
    MessageTemplate(
        "SMS_RESUME_READY",
        "SMS",
        "sms.resume_ready",
        "Your BharatPath profile is ready to review. Open the app to check it and confirm.",
        (),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_RESUME_UNREADABLE",
        "SMS",
        "sms.resume_unreadable",
        "We could not read your uploaded file. Open BharatPath to upload it again "
        "or type your details in.",
        (),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_APPLICATION_SENT",
        "SMS",
        "sms.application_sent",
        "Your application to {employer} has been sent.",
        ("employer",),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_APPLICATION_UPDATE",
        "SMS",
        "sms.application_update",
        "There is an update on your application to {employer}. Open BharatPath to see it.",
        ("employer",),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_INTERVIEW_REMINDER",
        "SMS",
        "sms.interview_reminder",
        "Your BharatPath practice interview is ready. Find a quiet place and keep "
        "your headphones nearby.",
        (),
        "SERVICE_IMPLICIT",
    ),
    # An invitation from a roster import goes to a contact who may
    # have no account yet, so it names no code: the student accepts from the
    # app, signed in with the number or address the college uploaded.
    MessageTemplate(
        "SMS_COLLEGE_INVITATION",
        "SMS",
        "sms.college_invitation",
        "{college} has invited you to link your profile on BharatPath. "
        "Sign in with this number to accept.",
        ("college",),
        "SERVICE_IMPLICIT",
    ),
    # R9. **SERVICE_EXPLICIT, not IMPLICIT**: a reminder to someone
    # who has not used the service yet is only deliverable to a DND number
    # with their recorded consent, and registering it as implicit to get
    # round that is the compliance breach the category exists to catch.
    MessageTemplate(
        "SMS_PROFILE_INCOMPLETE",
        "SMS",
        "sms.profile_incomplete",
        "Your BharatPath profile is not finished. Upload your CV or type your details "
        "in the app to build it.",
        (),
        "SERVICE_EXPLICIT",
    ),
    MessageTemplate(
        "SMS_COLLEGE_INVITE",
        "SMS",
        "sms.college_invite",
        "{college} has sent you a BharatPath code: {code}. Enter it in the app to "
        "link your profile to your college.",
        ("college", "code"),
        "SERVICE_IMPLICIT",
    ),
)

# ---------------------------------------------------------------------------
# Access periods
# ---------------------------------------------------------------------------
# "Nothing free" means an expiring period takes the product away, so the warning
# has to arrive early enough to act on. Nothing here mentions an amount: the
# message tells you access is ending and where to go, and the app tells you what
# it costs. A price in an SMS ages badly and reads like an advertisement, which
# would make it promotional and therefore undeliverable to a DND number.

ACCESS_TEMPLATES: Final[tuple[MessageTemplate, ...]] = (
    MessageTemplate(
        "SMS_ACCESS_ENDING",
        "SMS",
        "sms.access_ending",
        "Your BharatPath access ends on {date}. Open the app to continue without a break.",
        ("date",),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_ACCESS_ENDED",
        "SMS",
        "sms.access_ended",
        "Your BharatPath access has ended. Your profile is saved. Open the app to restore it.",
        (),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_PAYMENT_RECEIVED",
        "SMS",
        "sms.payment_received",
        "We have received your payment of {amount}. Your BharatPath access runs until {date}.",
        ("amount", "date"),
        "TRANSACTIONAL",
    ),
    MessageTemplate(
        "SMS_PAYMENT_FAILED",
        "SMS",
        "sms.payment_failed",
        "Your BharatPath payment did not go through. Open the app to try again.",
        (),
        "TRANSACTIONAL",
    ),
    # Pre-debit notification. **Not optional and not a courtesy** -- UPI AutoPay
    # requires the payer to be told before every automatic debit, and this is
    # that notice.
    MessageTemplate(
        "SMS_MANDATE_PRE_DEBIT",
        "SMS",
        "sms.mandate_pre_debit",
        "{amount} will be debited on {date} for BharatPath. To stop it, cancel in your UPI app.",
        ("amount", "date"),
        "TRANSACTIONAL",
    ),
)

# ---------------------------------------------------------------------------
# Business pool
# ---------------------------------------------------------------------------

BUSINESS_TEMPLATES: Final[tuple[MessageTemplate, ...]] = (
    MessageTemplate(
        "SMS_KYB_APPROVED",
        "SMS",
        "sms.kyb_approved",
        "Your BharatPath organisation account has been approved. You can sign in now.",
        (),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_KYB_NEEDS_INFO",
        "SMS",
        "sms.kyb_needs_info",
        "Your BharatPath organisation account needs more information. "
        "Sign in to see what is missing.",
        (),
        "SERVICE_IMPLICIT",
    ),
    MessageTemplate(
        "SMS_TEAM_INVITE",
        "SMS",
        "sms.team_invite",
        "{inviter} has invited you to join {org} on BharatPath. Check your email to accept.",
        ("inviter", "org"),
        "SERVICE_IMPLICIT",
    ),
)

# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
# No DLT, no 70-character limit, and it can carry the things SMS must not --
# a receipt, a link, an explanation. Deliberately short anyway.

EMAIL_TEMPLATES: Final[tuple[MessageTemplate, ...]] = (
    MessageTemplate(
        "EMAIL_WELCOME",
        "EMAIL",
        "email.welcome",
        "Your BharatPath account is ready. Upload a CV or type your details in, "
        "and we will build your profile.",
        (),
        subject="Welcome to BharatPath",
    ),
    MessageTemplate(
        "EMAIL_PAYMENT_RECEIPT",
        "EMAIL",
        "email.payment_receipt",
        "Receipt for {amount}, paid on {date}. Reference {reference}. "
        "Your access runs until {until}.",
        ("amount", "date", "reference", "until"),
        subject="Your BharatPath receipt",
    ),
    MessageTemplate(
        "EMAIL_DELETION_CONFIRMED",
        "EMAIL",
        "email.deletion_confirmed",
        "Your BharatPath account and profile have been deleted. "
        "Records we are required by law to keep are listed below.",
        (),
        subject="Your BharatPath account has been deleted",
    ),
    MessageTemplate(
        "EMAIL_DATA_EXPORT_READY",
        "EMAIL",
        "email.data_export_ready",
        "The copy of your BharatPath data is ready. The link below works for {hours} hours.",
        ("hours",),
        subject="Your BharatPath data is ready",
    ),
    MessageTemplate(
        "EMAIL_PROFILE_INCOMPLETE",
        "EMAIL",
        "email.profile_incomplete",
        "Your BharatPath profile is not finished yet. Upload a CV or type your details "
        "in, and we will build it for you.",
        (),
        subject="Finish your BharatPath profile",
    ),
    MessageTemplate(
        "EMAIL_COLLEGE_INVITATION",
        "EMAIL",
        "email.college_invitation",
        "{college} has invited you to link your profile on BharatPath. Sign in with "
        "this email address to accept.",
        ("college",),
        subject="An invitation from your college",
    ),
    # 2026-09-18: what the SMS drafts said, by email, now that no SMS is sent.
    MessageTemplate(
        "EMAIL_APPLICATION_SENT",
        "EMAIL",
        "email.application_sent",
        "Your application to {employer} has been sent. You can follow it in the BharatPath app.",
        ("employer",),
        subject="Your application has been sent",
    ),
    MessageTemplate(
        "EMAIL_APPLICATION_UPDATE",
        "EMAIL",
        "email.application_update",
        "There is an update on your application to {employer}. Open BharatPath to see it.",
        ("employer",),
        subject="An update on your application",
    ),
    # 2026-10-05: an employer invited the candidate from search to a job.
    MessageTemplate(
        "EMAIL_SHORTLIST_INVITED",
        "EMAIL",
        "email.shortlist_invited",
        "{employer} has shortlisted you for a job. Open BharatPath to see the role and "
        "accept or decline.",
        ("employer",),
        subject="You have been shortlisted for a job",
    ),
    MessageTemplate(
        "EMAIL_PAYMENT_FAILED",
        "EMAIL",
        "email.payment_failed",
        "Your BharatPath payment did not go through, and you have not been charged for it. "
        "Open the app to try again.",
        (),
        subject="Your payment did not go through",
    ),
    MessageTemplate(
        "EMAIL_ACCESS_ENDED",
        "EMAIL",
        "email.access_ended",
        "Your BharatPath access has ended. Everything you saved is still here; open the "
        "app to restore it.",
        (),
        subject="Your BharatPath access has ended",
    ),
    # The UPI AutoPay pre-debit notice. **Required before every automatic
    # debit**, so it is `mandatory` in `domain.plan_for` and ignores the
    # payer's email preference. Now the only channel it has besides the inbox.
    MessageTemplate(
        "EMAIL_MANDATE_PRE_DEBIT",
        "EMAIL",
        "email.mandate_pre_debit",
        "{amount} will be debited on {date} to renew your BharatPath access. To stop it, "
        "cancel the mandate in your UPI app before then.",
        ("amount", "date"),
        subject="An automatic payment is coming up",
    ),
    MessageTemplate(
        "EMAIL_KYB_APPROVED",
        "EMAIL",
        "email.kyb_approved",
        "Your organisation has been verified on BharatPath. You can sign in and publish jobs.",
        (),
        subject="Your organisation is verified",
    ),
    MessageTemplate(
        "EMAIL_KYB_NEEDS_INFO",
        "EMAIL",
        "email.kyb_needs_info",
        "Your organisation's verification on BharatPath needs more information. Sign in to "
        "see what is missing.",
        (),
        subject="Your verification needs more information",
    ),
    # 2026-09-29: an employer writing to an applicant. `{message}` is their
    # own words; `{link}` is a bare https link, or nothing, so no sentence
    # depends on it. An assessment with a deadline has its own template
    # because "by {when}" cannot be made optional in every language.
    MessageTemplate(
        "EMAIL_INTERVIEW_INVITATION",
        "EMAIL",
        "email.interview_invitation",
        "{employer} would like to interview you on {when}.\n{link}\n\n{message}\n\n"
        "Open BharatPath to see your application.",
        ("employer", "when", "link", "message"),
        subject="An interview invitation",
    ),
    MessageTemplate(
        "EMAIL_ASSESSMENT_INVITATION",
        "EMAIL",
        "email.assessment_invitation",
        "{employer} has asked you to take an online assessment.\n{link}\n\n{message}\n\n"
        "Open BharatPath to see your application.",
        ("employer", "link", "message"),
        subject="An online assessment",
    ),
    MessageTemplate(
        "EMAIL_ASSESSMENT_INVITATION_DEADLINE",
        "EMAIL",
        "email.assessment_invitation_deadline",
        "{employer} has asked you to take an online assessment by {when}.\n{link}\n\n"
        "{message}\n\nOpen BharatPath to see your application.",
        ("employer", "when", "link", "message"),
        subject="An online assessment",
    ),
    MessageTemplate(
        "EMAIL_EMPLOYER_MESSAGE",
        "EMAIL",
        "email.employer_message",
        "{employer} has sent you a message about your application:\n\n{message}\n\n"
        "Open BharatPath to see your application.",
        ("employer", "message"),
        subject="A message about your application",
    ),
)

# ---------------------------------------------------------------------------
# In-app
# ---------------------------------------------------------------------------
# The inbox. No DLT, no provider and nothing leaves our database, so this is
# the channel that always works -- which is exactly why it must obey the same
# rules as the others: no score, no amount, and nobody named who is not the
# reader's to know about.

IN_APP_TEMPLATES: Final[tuple[MessageTemplate, ...]] = (
    MessageTemplate(
        "IN_APP_APPLICATION_SENT",
        "IN_APP",
        "in_app.application_sent",
        "Your application to {employer} has been sent.",
        ("employer",),
    ),
    MessageTemplate(
        "IN_APP_APPLICATION_UPDATE",
        "IN_APP",
        "in_app.application_update",
        "There is an update on your application to {employer}.",
        ("employer",),
    ),
    MessageTemplate(
        "IN_APP_SHORTLIST_INVITED",
        "IN_APP",
        "in_app.shortlist_invited",
        "{employer} has shortlisted you for a job. Accept or decline.",
        ("employer",),
    ),
    MessageTemplate(
        "IN_APP_PAYMENT_RECEIVED",
        "IN_APP",
        "in_app.payment_received",
        "We have received your payment. Thank you.",
    ),
    MessageTemplate(
        "IN_APP_PAYMENT_FAILED",
        "IN_APP",
        "in_app.payment_failed",
        "Your payment did not go through. You can try again.",
    ),
    MessageTemplate(
        "IN_APP_ACCESS_ENDED",
        "IN_APP",
        "in_app.access_ended",
        "Your access has ended. Everything you saved is still here.",
    ),
    MessageTemplate(
        "IN_APP_PRE_DEBIT",
        "IN_APP",
        "in_app.pre_debit",
        "{amount} will be debited on {date} to continue your access.",
        ("amount", "date"),
    ),
    MessageTemplate(
        "IN_APP_KYB_APPROVED",
        "IN_APP",
        "in_app.kyb_approved",
        "Your organisation has been verified.",
    ),
    MessageTemplate(
        "IN_APP_KYB_NEEDS_INFO",
        "IN_APP",
        "in_app.kyb_needs_info",
        "Your organisation's verification needs more information.",
    ),
    MessageTemplate(
        "IN_APP_INTERVIEW_FEEDBACK_READY",
        "IN_APP",
        "in_app.interview_feedback_ready",
        "The feedback on your practice interview is ready.",
    ),
    # **Neither college message names the student.** A college
    # can read its dashboard before and after this arrives; a name beside
    # that would tell it whose band just left the distribution.
    MessageTemplate(
        "IN_APP_COLLEGE_STUDENT_DISCONNECTED",
        "IN_APP",
        "in_app.college_student_disconnected",
        "A student has disconnected their profile from your college.",
    ),
    MessageTemplate(
        "IN_APP_COLLEGE_STUDENT_STOPPED_SHARING",
        "IN_APP",
        "in_app.college_student_stopped_sharing",
        "A student has stopped sharing their details with your college.",
    ),
    MessageTemplate(
        "IN_APP_DISPUTE_ANSWERED",
        "IN_APP",
        "in_app.dispute_answered",
        "We have answered your dispute. Open it to read our reply.",
    ),
    MessageTemplate(
        "IN_APP_PROFILE_INCOMPLETE",
        "IN_APP",
        "in_app.profile_incomplete",
        "Upload your CV or type your details in to build your profile.",
    ),
    # 2026-09-29. Short: the message itself is on the application.
    MessageTemplate(
        "IN_APP_INTERVIEW_INVITATION",
        "IN_APP",
        "in_app.interview_invitation",
        "{employer} would like to interview you on {when}.",
        ("employer", "when"),
    ),
    MessageTemplate(
        "IN_APP_ASSESSMENT_INVITATION",
        "IN_APP",
        "in_app.assessment_invitation",
        "{employer} has asked you to take an online assessment.",
        ("employer",),
    ),
    MessageTemplate(
        "IN_APP_EMPLOYER_MESSAGE",
        "IN_APP",
        "in_app.employer_message",
        "{employer} has sent you a message about your application.",
        ("employer",),
    ),
)


TEMPLATES: Final[tuple[MessageTemplate, ...]] = (
    AUTH_TEMPLATES
    + CANDIDATE_TEMPLATES
    + ACCESS_TEMPLATES
    + BUSINESS_TEMPLATES
    + EMAIL_TEMPLATES
    + IN_APP_TEMPLATES
)

TEMPLATE_CODES: Final[frozenset[str]] = frozenset(t.code for t in TEMPLATES)


def template_by_code(code: str) -> MessageTemplate | None:
    return next((t for t in TEMPLATES if t.code == code), None)


def sms_templates() -> tuple[MessageTemplate, ...]:
    """Every template that needs a DLT registration. This is the list to take
    to the portal."""
    return tuple(t for t in TEMPLATES if t.channel == "SMS")


def unregistered_sms() -> tuple[str, ...]:
    """SMS templates that cannot be sent yet. Everything, today."""
    return tuple(t.code for t in sms_templates() if not is_dlt_ready(t))
