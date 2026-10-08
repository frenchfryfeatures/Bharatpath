"""The college onboarding form.

**Shorter than the employer form on purpose.** A college is a B2B deal with
seats assigned by an admin (client, 2026-08-24), so somebody at our end has
already spoken to them before this form is filled in. The form records what the
platform needs to operate the account; it is not doing the verification work
that a conversation and a signed agreement already did.

**AISHE code instead of a pile of documents.** Every recognised
higher-education institution in India carries one, and it is the closest thing
to a national registry -- so it can confirm an institution exists without asking
a placement officer to scan an affiliation certificate. It is optional, because
ITIs, polytechnics and private training institutes may not have one, and those
are real customers.

**The placement officer is a person, and their details are staff data.** Nothing
in this section is `public`. A candidate never needs to see it, and an employer
never needs to see it at all.
"""

from __future__ import annotations

from typing import Final

from app.core.forms import (
    AISHE_PATTERN,
    INDIAN_MOBILE_PATTERN,
    PAN_PATTERN,
    FormDefinition,
    FormField,
    FormSection,
)

FORM_VERSION: Final = "placeholder-1-2026-09-11"

#: Deliberately wider than "college". A polytechnic and an ITI place students
#: into exactly the jobs this marketplace carries, and a list that starts at
#: "university" quietly excludes them.
INSTITUTION_TYPES: Final[tuple[tuple[str, str], ...]] = (
    ("UNIVERSITY", "University"),
    ("DEEMED_UNIVERSITY", "Deemed university"),
    ("AUTONOMOUS_COLLEGE", "Autonomous college"),
    ("AFFILIATED_COLLEGE", "Affiliated college"),
    ("ENGINEERING_COLLEGE", "Engineering college"),
    ("MANAGEMENT_INSTITUTE", "Management institute"),
    ("POLYTECHNIC", "Polytechnic"),
    ("ITI", "Industrial Training Institute"),
    ("TRAINING_INSTITUTE", "Private training institute"),
    ("OTHER", "Other"),
)

#: For `placement_season_start`. Codes, not names: every client renders its own
#: language.
MONTHS: Final[tuple[tuple[str, str], ...]] = (
    ("JANUARY", "January"),
    ("FEBRUARY", "February"),
    ("MARCH", "March"),
    ("APRIL", "April"),
    ("MAY", "May"),
    ("JUNE", "June"),
    ("JULY", "July"),
    ("AUGUST", "August"),
    ("SEPTEMBER", "September"),
    ("OCTOBER", "October"),
    ("NOVEMBER", "November"),
    ("DECEMBER", "December"),
)

INSTITUTION = FormSection(
    "institution",
    "About your institution",
    (
        FormField(
            "legal_name",
            "college.legal_name",
            "Registered name of the institution",
            "TEXT",
            required=True,
            max_length=255,
            public=True,
        ),
        FormField(
            "institution_type",
            "college.institution_type",
            "What kind of institution is this?",
            "SELECT",
            required=True,
            options_source="college.INSTITUTION_TYPES",
            public=True,
        ),
        FormField(
            "aishe_code",
            "college.aishe_code",
            "AISHE code",
            "TEXT",
            pattern=AISHE_PATTERN,
            max_length=16,
            help_text="Leave blank if your institution does not have one.",
            verification_note="Checked against the AISHE listing for the named institution.",
        ),
        FormField(
            "affiliating_university",
            "college.affiliating_university",
            "Affiliating university",
            "TEXT",
            max_length=255,
            help_text="Only if your institution is affiliated to one.",
            public=True,
        ),
        FormField(
            "pan",
            "college.pan",
            "PAN of the institution or its trust",
            "TEXT",
            pattern=PAN_PATTERN,
            max_length=10,
            help_text="Needed for the invoice.",
        ),
        FormField(
            "website",
            "college.website",
            "Website",
            "TEXT",
            max_length=255,
            public=True,
        ),
    ),
)

ADDRESS = FormSection(
    "address",
    "Campus address",
    (
        FormField(
            "address_line1",
            "college.address_line1",
            "Address",
            "TEXT",
            required=True,
            max_length=255,
        ),
        FormField(
            "city",
            "college.city",
            "City or town",
            "TEXT",
            required=True,
            max_length=120,
            public=True,
        ),
        FormField(
            "state",
            "college.state",
            "State",
            "SELECT",
            required=True,
            options_source="reference.INDIAN_STATES",
            public=True,
        ),
        FormField(
            "pincode",
            "college.pincode",
            "PIN code",
            "TEXT",
            required=True,
            pattern=r"^[1-9][0-9]{5}$",
            max_length=6,
        ),
    ),
)

PLACEMENT_CONTACT = FormSection(
    "placement_contact",
    "Placement office",
    (
        FormField(
            "officer_name",
            "college.officer_name",
            "Name of the placement officer",
            "TEXT",
            required=True,
            max_length=180,
        ),
        FormField(
            "officer_designation",
            "college.officer_designation",
            "Their designation",
            "TEXT",
            max_length=120,
        ),
        FormField(
            "officer_email",
            "college.officer_email",
            "Work email address",
            "EMAIL",
            required=True,
            max_length=255,
            verification_note="Confirmed by a link sent to this address.",
        ),
        FormField(
            "officer_phone",
            "college.officer_phone",
            "Contact number",
            "PHONE",
            required=True,
            pattern=INDIAN_MOBILE_PATTERN,
            max_length=13,
        ),
        FormField(
            "alternate_contact_email",
            "college.alternate_contact_email",
            "A second email address",
            "EMAIL",
            max_length=255,
            # Placement officers change between academic years, and an account
            # whose only contact has left the institution cannot be recovered
            # without a support conversation and a judgment call about who
            # really owns it.
            help_text="So the account is not lost if the placement officer changes.",
        ),
    ),
)

COHORT = FormSection(
    "cohort",
    "Your students",
    (
        FormField(
            "students_per_year",
            "college.students_per_year",
            "Roughly how many students finish each year?",
            "NUMBER",
            required=True,
            help_text="An approximate number is fine. It helps us suggest the right seat count.",
        ),
        FormField(
            "departments",
            "college.departments",
            "Which departments or streams would use this?",
            "TEXTAREA",
            max_length=1000,
        ),
        FormField(
            "placement_season_start",
            "college.placement_season_start",
            "When does your placement season usually start?",
            "SELECT",
            options_source="college.MONTHS",
            help_text="So we can make sure seats are active before it begins.",
        ),
    ),
)

UNDERTAKINGS = FormSection(
    "undertakings",
    "Before you finish",
    (
        # A college holds a roster, not the students' consent. The distinction
        # is the whole design of the referral-code flow: entering a code is the
        # student's own consent act, and it grants ROSTER scope only. This box
        # is where the institution acknowledges that it cannot grant it for
        # them.
        FormField(
            "undertaking_student_consent",
            "college.undertaking_student_consent",
            "We understand that each student connects their own profile, "
            "and that we cannot do it on their behalf.",
            "CHECKBOX",
            required=True,
        ),
        FormField(
            "undertaking_authorised",
            "college.undertaking_authorised",
            "I am authorised to accept these terms for this institution.",
            "CHECKBOX",
            required=True,
        ),
    ),
)

COLLEGE_FORM: Final = FormDefinition(
    "COLLEGE_ONBOARDING",
    FORM_VERSION,
    (INSTITUTION, ADDRESS, PLACEMENT_CONTACT, COHORT, UNDERTAKINGS),
)
