"""The employer onboarding and KYB form.

Produced 2026-09-11 under `answers-log.md` Round 7.10, closing the employer half
of blocker C8. The employer type and industry lists it references were confirmed
by the client in Round 7.5 and live in `employer/reference.py`.

---

**This form is currently decoration, and that is the risk worth naming.**

`kyb.require_approval` defaults to *off* (client, 2026-08-27), so an employer
fills this in, is approved automatically, pays, and can then read every
candidate's contact details. Nothing below is checked by anyone. That is
blocker N4/B7 -- the bulk-extraction risk -- and collecting more fields does not
reduce it, because the problem is not what we ask, it is that nobody reads the
answers.

What the form *can* do meanwhile is make the data good enough that turning
approval on later is a policy change rather than a re-onboarding exercise: the
identifiers are captured, the formats are enforced, and the documents are
uploaded and stored. `verification_note` marks the fields a reviewer would have
to positively confirm on the day that switch is flipped.

**Almost nothing is required.** An Indian employer might be a private limited
company with a CIN, an LLP with an LLPIN, a partnership with neither, or a
proprietor operating on a personal PAN. A form that demands a CIN excludes most
small employers in the country. The one universal identifier is PAN, and that is
the one required field of the three.
"""

from __future__ import annotations

from typing import Final

from app.core.forms import (
    CIN_PATTERN,
    GSTIN_PATTERN,
    INDIAN_MOBILE_PATTERN,
    PAN_PATTERN,
    TAN_PATTERN,
    FormDefinition,
    FormField,
    FormSection,
)
from app.core.reference import EMPLOYEE_COUNT_BANDS as EMPLOYEE_COUNT_BANDS

FORM_VERSION: Final = "placeholder-1-2026-09-11"

ORGANISATION = FormSection(
    "organisation",
    "About your organisation",
    (
        FormField(
            "legal_name",
            "kyb.legal_name",
            "Registered name of the organisation",
            "TEXT",
            required=True,
            max_length=255,
            help_text="Exactly as it appears on your PAN or registration certificate.",
            public=False,
        ),
        FormField(
            "trade_name",
            "kyb.trade_name",
            "Name candidates would recognise",
            "TEXT",
            max_length=255,
            help_text="Leave blank if it is the same as the registered name.",
            # The only name a candidate ever sees. A jobseeker does not
            # recognise "Brightline Technologies Private Limited" and does
            # recognise the brand above the door.
            public=True,
        ),
        FormField(
            "employer_type",
            "kyb.employer_type",
            "What kind of organisation is this?",
            "SELECT",
            required=True,
            options_source="employer.EMPLOYER_TYPES",
            public=True,
        ),
        FormField(
            "industry",
            "kyb.industry",
            "Which sector do you work in?",
            "SELECT",
            required=True,
            options_source="employer.INDUSTRIES",
            public=True,
        ),
        FormField(
            "employee_count_band",
            "kyb.employee_count_band",
            "Roughly how many people work here?",
            "SELECT",
            options_source="kyb.EMPLOYEE_COUNT_BANDS",
            public=True,
        ),
        FormField(
            "website",
            "kyb.website",
            "Website",
            "TEXT",
            max_length=255,
            help_text="Optional. A social media page is fine if you do not have a website.",
            public=True,
        ),
        FormField(
            "about",
            "kyb.about",
            "What does your organisation do?",
            "TEXTAREA",
            max_length=1000,
            help_text="Shown to candidates. Two or three sentences is plenty.",
            public=True,
        ),
    ),
)

IDENTIFIERS = FormSection(
    "identifiers",
    "Registration details",
    (
        FormField(
            "pan",
            "kyb.pan",
            "PAN",
            "TEXT",
            required=True,
            pattern=PAN_PATTERN,
            max_length=10,
            help_text="Every registered organisation and proprietor has one.",
            verification_note="Must match the name on the uploaded PAN document.",
        ),
        FormField(
            "gstin",
            "kyb.gstin",
            "GSTIN",
            "TEXT",
            pattern=GSTIN_PATTERN,
            max_length=15,
            help_text="Leave blank if your organisation is not registered for GST.",
            verification_note="State code must match the registered address.",
        ),
        FormField(
            "cin",
            "kyb.cin",
            "CIN or LLPIN",
            "TEXT",
            pattern=CIN_PATTERN,
            max_length=21,
            help_text="Only companies and LLPs have one. Leave blank otherwise.",
        ),
        FormField(
            "tan",
            "kyb.tan",
            "TAN",
            "TEXT",
            pattern=TAN_PATTERN,
            max_length=10,
            help_text="Optional.",
        ),
    ),
    help_text="We ask for these to confirm the organisation is real. "
    "Only the name and sector are shown to candidates.",
)

ADDRESS = FormSection(
    "address",
    "Registered address",
    (
        FormField(
            "address_line1", "kyb.address_line1", "Address", "TEXT", required=True, max_length=255
        ),
        FormField("address_line2", "kyb.address_line2", "Address line 2", "TEXT", max_length=255),
        FormField(
            "city", "kyb.city", "City or town", "TEXT", required=True, max_length=120, public=True
        ),
        FormField(
            "state",
            "kyb.state",
            "State",
            "SELECT",
            required=True,
            options_source="reference.INDIAN_STATES",
            public=True,
        ),
        FormField(
            "pincode",
            "kyb.pincode",
            "PIN code",
            "TEXT",
            required=True,
            pattern=r"^[1-9][0-9]{5}$",
            max_length=6,
        ),
    ),
)

CONTACT = FormSection(
    "contact",
    "Who we should contact",
    (
        FormField(
            "signatory_name",
            "kyb.signatory_name",
            "Name of the authorised person",
            "TEXT",
            required=True,
            max_length=180,
        ),
        FormField(
            "signatory_designation",
            "kyb.signatory_designation",
            "Their designation",
            "TEXT",
            required=True,
            max_length=120,
        ),
        FormField(
            "work_email",
            "kyb.work_email",
            "Work email address",
            "EMAIL",
            required=True,
            max_length=255,
            # A free email address is accepted deliberately. Most small Indian
            # employers genuinely run on one, and refusing them would shrink
            # the marketplace far more than it would raise the bar -- a
            # determined bad actor registers a domain for a few hundred rupees.
            help_text="A company email address if you have one.",
            verification_note="Confirmed by a link sent to this address.",
        ),
        FormField(
            "work_phone",
            "kyb.work_phone",
            "Contact number",
            "PHONE",
            required=True,
            pattern=INDIAN_MOBILE_PATTERN,
            max_length=13,
        ),
    ),
)

DOCUMENTS = FormSection(
    "documents",
    "Documents",
    (
        FormField(
            "doc_pan",
            "kyb.doc_pan",
            "PAN card",
            "FILE",
            required=True,
            verification_note="Name and number must match the fields above.",
        ),
        FormField(
            "doc_registration",
            "kyb.doc_registration",
            "Certificate of incorporation or registration",
            "FILE",
            help_text="If your organisation has one.",
            verification_note="Entity name must match the registered name.",
        ),
        FormField(
            "doc_gst",
            "kyb.doc_gst",
            "GST registration certificate",
            "FILE",
            help_text="Only if you are registered for GST.",
        ),
        FormField(
            "doc_authorisation",
            "kyb.doc_authorisation",
            "Letter authorising the person named above",
            "FILE",
            help_text="On your organisation's letterhead.",
            verification_note="Signatory name must match the contact section.",
        ),
    ),
    help_text="Photographs of the documents are fine as long as the text is readable.",
)

UNDERTAKINGS = FormSection(
    "undertakings",
    "Before you finish",
    (
        # These two are the only mechanism standing between an auto-approved
        # employer and every candidate's phone number. A tick box is weak, and
        # it is deliberately worded as an undertaking rather than as terms:
        # it is the thing that makes misuse a breach the client can point at.
        FormField(
            "undertaking_genuine_hiring",
            "kyb.undertaking_genuine_hiring",
            "We will use candidate details only to contact people about genuine jobs.",
            "CHECKBOX",
            required=True,
        ),
        FormField(
            "undertaking_no_redistribution",
            "kyb.undertaking_no_redistribution",
            "We will not sell, share or publish candidate details.",
            "CHECKBOX",
            required=True,
        ),
        FormField(
            "undertaking_authorised",
            "kyb.undertaking_authorised",
            "I am authorised to accept these terms for this organisation.",
            "CHECKBOX",
            required=True,
        ),
    ),
)

KYB_FORM: Final = FormDefinition(
    "EMPLOYER_KYB",
    FORM_VERSION,
    (ORGANISATION, IDENTIFIERS, ADDRESS, CONTACT, DOCUMENTS, UNDERTAKINGS),
)
