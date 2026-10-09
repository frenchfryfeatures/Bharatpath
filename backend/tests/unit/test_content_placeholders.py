"""The placeholder content we wrote for the client, and the rules it obeys.

None of this content is the client's yet. What these tests protect is not the
wording -- it is the set of properties that make the content *replaceable*
without anything breaking: codes stay unique, translations keep their
variables, SMS bodies stay inside a segment, and none of the forbidden
questions creep back in when somebody adds "just one more field".
"""

from __future__ import annotations

import re

import pytest

from app.core.forms import (
    AISHE_PATTERN,
    GSTIN_PATTERN,
    INDIAN_MOBILE_PATTERN,
    PAN_PATTERN,
)
from app.modules.college.forms import COLLEGE_FORM
from app.modules.courses.catalogue import (
    HAS_MEDIA,
    MODULES,
    lesson_count,
    missing_media,
    module_count,
    total_minutes,
)
from app.modules.courses.domain import CourseProgress, evaluate_completion
from app.modules.interview.bank import (
    DIMENSIONS,
    QUESTION_SETS,
    QUESTIONS_PER_SESSION,
    SESSIONS_THAT_EARN_POINTS,
    set_for_session,
)
from app.modules.kyb.forms import KYB_FORM
from app.modules.notifications.templates import (
    MAX_SOURCE_CHARS,
    MAX_VARIABLE_CHARS,
    TEMPLATES,
    is_dlt_ready,
    sms_templates,
    to_dlt_body,
    unregistered_sms,
)
from app.modules.questionnaire.bank import QUESTIONS, SECTIONS
from app.modules.subscriptions.catalogue import (
    CANDIDATE_PLANS,
    MIN_SEAT_SHARE_OF_DIRECT,
    PERIOD_MONTHS,
    PLACEHOLDER_PRICING,
    PLANS,
    PRODUCTS,
    format_inr,
    plan_by_code,
    plans_for,
    seat_share_of_direct,
)

# ===========================================================================
# Prices
# ===========================================================================


def test_prices_are_still_flagged_as_ours_rather_than_the_clients() -> None:
    """The flag is the thing that survives a demo to a paying customer. When
    this fails because someone set it False, that should have been a decision."""
    assert PLACEHOLDER_PRICING is True


def test_every_price_is_a_whole_number_of_paise() -> None:
    """Money is integer minor units. A float here is a rounding error that
    reaches an invoice."""
    for plan in PLANS:
        assert isinstance(plan.price_minor, int)
        assert plan.price_minor > 0, f"{plan.code} is free, which is not the model"
    for product in PRODUCTS:
        assert isinstance(product.price_minor, int)
        assert product.price_minor > 0


def test_plan_codes_are_unique() -> None:
    codes = [p.code for p in PLANS]
    assert len(codes) == len(set(codes))


def test_all_three_audiences_can_actually_buy_something() -> None:
    for audience in ("CANDIDATE", "EMPLOYER", "COLLEGE"):
        assert plans_for(audience), f"nothing to sell to {audience}"  # type: ignore[arg-type]


def test_a_longer_commitment_always_costs_less_per_month() -> None:
    """The one property a buyer checks immediately. An annual plan that works
    out dearer than monthly is not a pricing choice, it is a typo -- and it is
    the kind that survives review because every individual number looks fine."""
    for audience in ("CANDIDATE", "EMPLOYER", "COLLEGE"):
        ladder = sorted(
            plans_for(audience),  # type: ignore[arg-type]
            key=lambda p: (p.seat_allowance or 0, PERIOD_MONTHS[p.period]),
        )
        by_seats: dict[int, list[object]] = {}
        for plan in ladder:
            by_seats.setdefault(plan.seat_allowance or 0, []).append(plan)
        for group in by_seats.values():
            rates = [p.monthly_equivalent_minor for p in group]  # type: ignore[attr-defined]
            assert rates == sorted(rates, reverse=True), f"{audience} ladder inverts"


def test_more_seats_never_costs_less_in_total() -> None:
    college = [p for p in plans_for("COLLEGE") if p.seat_allowance]
    for period in {p.period for p in college}:
        tier = sorted(
            (p for p in college if p.period == period),
            key=lambda p: p.seat_allowance or 0,
        )
        totals = [p.price_minor for p in tier]
        assert totals == sorted(totals)


def test_a_seat_never_undercuts_direct_candidate_revenue() -> None:
    """**The test that would have caught C12, and did not exist to.**

    A college seat covers that student's subscription entirely (client,
    2026-09-12) -- they pay nothing. So the per-seat price is not a discount
    alongside candidate revenue, it *is* the candidate revenue, and a seat
    priced far below the direct subscription makes signing a college strictly
    worse than not signing one.

    The first price list sat at about 10% of direct. Nothing failed, because
    every check here was structural -- totals ascending, periods consistent,
    tax flags right -- and a number can satisfy all of that while being an
    order of magnitude wrong about what it is selling.

    Ex-tax on both sides. Comparing an inclusive candidate price with an
    exclusive college one flatters the seat by 18%, which is the same mistake
    in miniature.
    """
    for plan in plans_for("COLLEGE"):
        share = seat_share_of_direct(plan)
        if share is None:
            continue
        assert share >= MIN_SEAT_SHARE_OF_DIRECT, (
            f"{plan.code}: a seat earns {share:.1%} of what that student would "
            f"pay directly ({format_inr(plan.per_seat_minor or 0)} ex-tax). "
            "Below the floor, every college deal displaces more revenue than "
            "it books."
        )


def test_a_seat_is_a_discount_and_not_a_markup() -> None:
    """The other side of the same floor. A seat costing *more* than the direct
    subscription means the college is paying a premium to buy in bulk, which
    no placement cell will do twice."""
    for plan in plans_for("COLLEGE"):
        share = seat_share_of_direct(plan)
        if share is not None:
            assert share < 1.0, f"{plan.code} prices a seat above the direct subscription"


def test_every_seat_period_has_a_candidate_plan_to_price_against() -> None:
    """`seat_share_of_direct` compares against the candidate plan of the same
    duration. A college period with no candidate twin would make the floor
    above silently unenforceable -- it returns None and the check skips."""
    candidate_months = {PERIOD_MONTHS[p.period] for p in CANDIDATE_PLANS}
    for plan in plans_for("COLLEGE"):
        if plan.seat_allowance:
            assert PERIOD_MONTHS[plan.period] in candidate_months, (
                f"{plan.code} has no candidate plan of the same duration, so its "
                "per-seat price is not being checked against anything."
            )


def test_removing_gst_is_only_applied_to_inclusive_prices() -> None:
    """A business price is already ex-tax. Dividing it again would understate
    every employer and college plan by 18% in exactly the comparison this
    module now makes decisions from."""
    for plan in PLANS:
        if plan.tax_inclusive:
            assert plan.price_ex_tax_minor < plan.price_minor, plan.code
        else:
            assert plan.price_ex_tax_minor == plan.price_minor, plan.code


def test_only_colleges_carry_a_seat_allowance() -> None:
    """Seats are the college model. An employer plan with a seat count would
    quietly reintroduce the per-unlock pricing the client rejected."""
    for plan in PLANS:
        if plan.audience != "COLLEGE":
            assert plan.seat_allowance is None, plan.code


def test_consumer_prices_are_tax_inclusive_and_business_prices_are_not() -> None:
    """Backwards, this is an 18% revenue error discovered at the first GST
    filing."""
    for plan in PLANS:
        expected = plan.audience == "CANDIDATE"
        assert plan.tax_inclusive is expected, plan.code


def test_lookup_by_code_works_and_misses_cleanly() -> None:
    assert plan_by_code("EMPLOYER_MONTHLY") is not None
    assert plan_by_code("NOT_A_PLAN") is None


def test_rupee_formatting_is_for_display_only() -> None:
    assert format_inr(499_900) == "₹4,999"
    assert format_inr(14_950) == "₹149.50"


# ===========================================================================
# Course
# ===========================================================================


def test_the_course_cannot_be_sold_because_nothing_is_recorded() -> None:
    """A candidate who pays for empty lessons is a refund and a bad review, and
    the +30 would be awarded for watching nothing."""
    assert HAS_MEDIA is False
    assert len(missing_media()) == lesson_count()


def test_the_syllabus_has_enough_in_it_to_be_a_course() -> None:
    assert module_count() >= 5
    assert lesson_count() >= 15
    assert total_minutes() >= 90


def test_module_and_lesson_codes_are_unique() -> None:
    module_codes = [m.code for m in MODULES]
    assert len(module_codes) == len(set(module_codes))
    lesson_codes = [lesson.code for m in MODULES for lesson in m.lessons]
    assert len(lesson_codes) == len(set(lesson_codes))


def test_every_lesson_states_what_the_learner_can_do_afterwards() -> None:
    """Written as an outcome because that is what makes an assessment question
    writable at all -- 'understands X' cannot be tested."""
    for module in MODULES:
        for lesson in module.lessons:
            assert lesson.outcome.strip()
            assert lesson.minutes > 0


def test_the_outline_is_not_what_is_sold() -> None:
    """Since 2026-09-29 the course a candidate buys is the lessons staff
    publish in the console, each with a playable video, and completing it
    means watching every one of them. This outline stays a proposal: it has
    no media, and `sync_catalogue` never puts a course on sale."""
    assert all(lesson.asset_key is None for m in MODULES for lesson in m.lessons)
    assert not evaluate_completion(CourseProgress(0, 0)).complete
    assert evaluate_completion(CourseProgress(lesson_count(), lesson_count())).complete


def test_the_syllabus_never_names_a_scoring_weight() -> None:
    """The score is never explained (client, twice). A course that taught the
    rubric would contradict the product and inflate every score without
    improving a single candidate."""
    forbidden = ("rubric", "weight", "band", "990", "points", "category cap")
    text = " ".join(
        [m.title for m in MODULES]
        + [lesson.title + " " + lesson.outcome for m in MODULES for lesson in m.lessons]
    ).lower()
    for word in forbidden:
        assert word not in text, f"the syllabus mentions {word!r}"


# ===========================================================================
# Questionnaire
# ===========================================================================

#: Fields that are ordinary on an Indian application form and are
#: straightforwardly discrimination vectors. Invariant 5 covers the age ones in
#: CI already; the rest are a product decision recorded here.
#
#: The date-of-birth abbreviation is deliberately absent from this list.
#: `scripts/check_no_age_fields.py` scans the whole repository for it and fails
#: the build, which is strictly stronger than a test over one module -- and it
#: would fail on *this file* for naming the string. The scanner working
#: correctly is not a reason to weaken it.
FORBIDDEN_ATTRIBUTES = (
    "age",
    "birth",
    "marital",
    "married",
    "spouse",
    "children",
    "dependant",
    "gender",
    "sex",
    "religion",
    "caste",
    "category",
    "community",
    "photo",
    "photograph",
)


@pytest.mark.parametrize("term", FORBIDDEN_ATTRIBUTES)
def test_the_questionnaire_never_asks_a_discriminatory_question(term: str) -> None:
    # Word boundaries, not a substring search. "age" is inside "language",
    # "disadvantage" and "arrangement", and a check that fires on those is a
    # check somebody switches off -- which is worse than not having it, because
    # it still looks like coverage.
    haystack = " ".join(
        [q.code + " " + q.key + " " + q.prompt + " " + (q.help_text or "") for q in QUESTIONS]
        + [o.code + " " + o.label for q in QUESTIONS for o in q.options]
    ).lower()
    assert not re.search(rf"\b{term}\w{{0,3}}\b", haystack), (
        f"the questionnaire asks about {term!r}"
    )


def test_every_question_is_skippable() -> None:
    """A mandatory optional questionnaire is not optional, and a candidate who
    is not employed cannot answer 'notice period'."""
    assert all(not q.required for q in QUESTIONS)


def test_closed_questions_have_options_and_open_ones_do_not() -> None:
    for question in QUESTIONS:
        if question.type in ("SINGLE", "MULTI"):
            # PREFERRED_LOCATIONS is answered against a searchable reference
            # table; a closed list of Indian cities is either wrong or enormous.
            assert question.options or question.code == "PREFERRED_LOCATIONS", question.code
        else:
            assert not question.options, question.code


def test_question_and_option_codes_are_unique() -> None:
    codes = [q.code for q in QUESTIONS]
    assert len(codes) == len(set(codes))
    for question in QUESTIONS:
        option_codes = [o.code for o in question.options]
        assert len(option_codes) == len(set(option_codes)), question.code


def test_the_free_text_question_is_not_searchable() -> None:
    """The accessibility field exists so a candidate can ask for an adjustment.
    Making it filterable would turn a support field into a screening field."""
    adjustments = next(q for q in QUESTIONS if q.code == "ACCESSIBILITY_ADJUSTMENTS")
    assert adjustments.type == "TEXT"
    assert adjustments.filterable is False


def test_every_question_belongs_to_exactly_one_section() -> None:
    flat = [q.code for section in SECTIONS.values() for q in section]
    assert len(flat) == len(set(flat)) == len(QUESTIONS)


# ===========================================================================
# Interview
# ===========================================================================


def test_there_is_one_distinct_question_set_per_purchasable_session() -> None:
    """Three is the cap. A candidate who buys all three and is asked the same
    six questions each time has been sold the same thing three times."""
    assert len(QUESTION_SETS) == SESSIONS_THAT_EARN_POINTS
    for question_set in QUESTION_SETS:
        assert len(question_set.questions) == QUESTIONS_PER_SESSION


def test_no_question_appears_in_two_sets() -> None:
    codes = [q.code for s in QUESTION_SETS for q in s.questions]
    assert len(codes) == len(set(codes))


def test_sessions_are_handed_out_in_order_not_at_random() -> None:
    assert set_for_session(1) is QUESTION_SETS[0]
    assert set_for_session(3) is QUESTION_SETS[2]
    assert set_for_session(4) is QUESTION_SETS[0]
    with pytest.raises(ValueError):
        set_for_session(0)


def test_the_rubric_never_assesses_accent_or_fluency() -> None:
    """An audio product used across eight languages by people whose first
    language is usually not English. These measure schooling and region."""
    forbidden = (
        "accent",
        "pronunciation",
        "fluency",
        "fluent",
        "grammar",
        "vocabulary",
        "pace",
        "speed",
        "filler",
        "pitch",
        "tone of voice",
    )
    text = " ".join(
        d.code + " " + d.label + " " + d.anchor_low + " " + d.anchor_high for d in DIMENSIONS
    ).lower()
    for word in forbidden:
        assert word not in text, f"the rubric assesses {word!r}"


def test_every_dimension_has_both_anchors() -> None:
    """'Rate clarity out of four' without anchors is four different rubrics in
    four different reviewers."""
    for dimension in DIMENSIONS:
        assert dimension.anchor_low.strip()
        assert dimension.anchor_high.strip()
        assert dimension.anchor_low != dimension.anchor_high


def test_every_question_says_what_a_good_answer_contains() -> None:
    for question_set in QUESTION_SETS:
        for question in question_set.questions:
            assert question.looking_for.strip()


# ===========================================================================
# Message templates
# ===========================================================================


def test_no_sms_can_be_sent_until_its_dlt_template_id_exists() -> None:
    """An unregistered body is dropped silently by the operator -- no error to
    us, no message to the user. Registration takes 2-4 weeks (blocker D1)."""
    assert set(unregistered_sms()) == {t.code for t in sms_templates()}
    assert all(not is_dlt_ready(t) for t in sms_templates())


def test_email_is_not_gated_on_dlt() -> None:
    for template in TEMPLATES:
        if template.channel == "EMAIL":
            assert is_dlt_ready(template)


@pytest.mark.parametrize("template", sms_templates(), ids=[t.code for t in sms_templates()])
def test_the_english_source_leaves_room_for_the_translation(template: object) -> None:
    """One non-GSM character switches the whole message to UCS-2 and the limit
    becomes 70 characters. Every Indian-language translation of these is
    UCS-2, and it is usually longer than the English."""
    body: str = template.body  # type: ignore[attr-defined]
    assert len(body) <= MAX_SOURCE_CHARS, f"{len(body)} chars"


def test_every_placeholder_in_a_body_is_declared() -> None:
    """An undeclared variable is never substituted, so the message goes out
    with a literal `{date}` in it -- and DLT registration would not match."""
    for template in TEMPLATES:
        used = set(re.findall(r"\{([a-z_][a-z0-9_]*)\}", template.body))
        assert used == set(template.variables), template.code


def test_the_dlt_registration_body_has_no_variables_left_in_it() -> None:
    """The portal matches the sent message against the registered body with
    variables substituted. Generating one from the other is what stops them
    drifting apart."""
    for template in sms_templates():
        rendered = to_dlt_body(template)
        assert "{#var#}" in rendered or not template.variables
        assert not re.search(r"\{[a-z_]", rendered), template.code


def test_variable_names_fit_the_dlt_limit() -> None:
    for template in TEMPLATES:
        for name in template.variables:
            assert len(name) <= MAX_VARIABLE_CHARS


def test_template_codes_are_unique() -> None:
    codes = [t.code for t in TEMPLATES]
    assert len(codes) == len(set(codes))


def test_no_message_ever_carries_the_score() -> None:
    """It sits behind a subscription, and an SMS is readable by anyone holding
    the phone."""
    for template in TEMPLATES:
        body = template.body.lower()
        assert "score" not in body, template.code
        assert "{score" not in body, template.code


def test_otp_messages_name_the_action_they_authorise() -> None:
    """'Your OTP is 123456' is exactly what a fraudster asks a victim to read
    out. Naming the action gives the victim the sentence that might stop them."""
    for code in ("SMS_LOGIN_OTP", "SMS_PHONE_VERIFY_OTP"):
        template = next(t for t in TEMPLATES if t.code == code)
        assert "code" in template.variables
        assert "do not share" in template.body.lower()


def test_otp_messages_are_in_the_category_that_reaches_a_dnd_number() -> None:
    """Registered as promotional, an OTP silently fails for most Indian
    numbers, and nobody can sign in."""
    for code in ("SMS_LOGIN_OTP", "SMS_PHONE_VERIFY_OTP"):
        template = next(t for t in TEMPLATES if t.code == code)
        assert template.dlt_category == "SERVICE_IMPLICIT"


def test_the_upi_pre_debit_notice_exists_and_says_when_and_how_much() -> None:
    """Required before every automatic debit. Not a courtesy."""
    template = next(t for t in TEMPLATES if t.code == "SMS_MANDATE_PRE_DEBIT")
    assert set(template.variables) == {"amount", "date"}


# ===========================================================================
# Translations -- moved to tests/unit/test_locales.py on 2026-09-22
# ===========================================================================
#
# They outgrew a section of this file when the client named six languages and
# 127 product keys (form labels, interview questions, notification bodies)
# were added to the bundles. `test_locales.py` also holds the two rules this
# section could not express: that only `PRIORITY_LOCALES` are held to full
# coverage, and that every bundle must declare whether a native speaker has
# actually read it.


# ===========================================================================
# Onboarding forms
# ===========================================================================

FORMS = (KYB_FORM, COLLEGE_FORM)


@pytest.mark.parametrize("form", FORMS, ids=[f.code for f in FORMS])
def test_field_codes_are_unique_within_a_form(form: object) -> None:
    codes = [f.code for f in form.fields]  # type: ignore[attr-defined]
    assert len(codes) == len(set(codes))


@pytest.mark.parametrize("form", FORMS, ids=[f.code for f in FORMS])
def test_every_field_has_a_translation_key_and_a_label(form: object) -> None:
    for field in form.fields:  # type: ignore[attr-defined]
        assert field.key.strip() and field.label.strip()


@pytest.mark.parametrize("form", FORMS, ids=[f.code for f in FORMS])
def test_every_declared_pattern_compiles(form: object) -> None:
    """A broken regex in a form definition reaches four clients before anyone
    notices it never matches."""
    for field in form.fields:  # type: ignore[attr-defined]
        if field.pattern:
            re.compile(field.pattern)


@pytest.mark.parametrize("form", FORMS, ids=[f.code for f in FORMS])
def test_choice_fields_name_where_their_options_come_from(form: object) -> None:
    for field in form.fields:  # type: ignore[attr-defined]
        if field.type in ("SELECT", "MULTISELECT"):
            assert field.options_source, field.code


@pytest.mark.parametrize("form", FORMS, ids=[f.code for f in FORMS])
def test_a_field_is_private_unless_someone_decided_otherwise(form: object) -> None:
    """Defaulting to public is the safer direction to get wrong, in the wrong
    direction. Contact details and identifiers must never be public."""
    for field in form.fields:  # type: ignore[attr-defined]
        if any(
            word in field.code
            for word in (
                "pan",
                "gstin",
                "cin",
                "tan",
                "phone",
                "email",
                "signatory",
                "officer",
                "doc_",
                "address_line",
            )
        ):
            assert not field.public, field.code


def test_the_only_required_identifier_is_the_one_every_employer_has() -> None:
    """A form that demands a CIN excludes proprietorships and partnerships,
    which is most small employers in India."""
    required = KYB_FORM.required_codes()
    assert "pan" in required
    assert "cin" not in required
    assert "gstin" not in required


def test_the_kyb_form_captures_the_undertakings_that_stand_in_for_review() -> None:
    """`kyb.require_approval` defaults to off, so nobody reads any of this.
    These three are what makes misuse a breach rather than a surprise."""
    required = KYB_FORM.required_codes()
    assert {
        "undertaking_genuine_hiring",
        "undertaking_no_redistribution",
        "undertaking_authorised",
    } <= required


def test_the_college_form_records_that_consent_is_the_students_to_give() -> None:
    """A college holds a roster, not the students' consent. Entering a referral
    code is the student's own act and grants ROSTER scope only."""
    assert "undertaking_student_consent" in COLLEGE_FORM.required_codes()


def test_the_student_consent_text_is_still_ours_rather_than_counsels() -> None:
    """The words a student agrees to when linking to a college are a
    placeholder, versioned so that replacing them re-asks rather than silently
    rebinding consent given to other words. Flipping this is counsel's call."""
    from app.modules.college.domain import CONSENT_VERSION, ROSTER_CONSENT_TEXT

    assert CONSENT_VERSION.startswith("placeholder-")
    text = ROSTER_CONSENT_TEXT.lower()
    assert "count" in text and "disconnect" in text
    assert "score" in text, "the terms must say the college does not see the score"


def test_the_individual_visibility_text_is_ours_and_names_what_the_college_sees() -> None:
    """Versioned separately from the roster text, and a placeholder
    like it. The words must name every field the college's view returns, so
    widening the view without changing them fails here and in invariant 9.

    Version 2 (client, 2026-09-29) shows the sign-up details, contact
    included, the CV, practice interviews, course progress and each
    application's stage. What it still withholds must still be said."""
    from app.modules.college.domain import (
        INDIVIDUAL_CONSENT_TEXT,
        INDIVIDUAL_CONSENT_VERSION,
        INDIVIDUAL_DETAILS_VERSIONS,
    )

    assert INDIVIDUAL_CONSENT_VERSION.startswith("placeholder-")
    assert INDIVIDUAL_CONSENT_VERSION in INDIVIDUAL_DETAILS_VERSIONS
    text = INDIVIDUAL_CONSENT_TEXT.lower()
    for shown in ("by name", "score", "band", "applied", "interviewed", "hired"):
        assert shown in text, shown
    for shown in ("phone", "email", "cv", "practice interviews", "courses", "stage"):
        assert shown in text, f"the terms must say the college sees {shown}"
    for withheld in ("recordings", "employer wrote"):
        assert withheld in text, f"the terms must say the college does not see {withheld}"
    assert "recorded" in text and "turn this off" in text


def test_the_college_form_asks_for_a_second_contact() -> None:
    """Placement officers change between academic years, and an account whose
    only contact has left cannot be recovered without a judgment call about who
    owns it."""
    assert COLLEGE_FORM.field_by_code("alternate_contact_email") is not None


def test_neither_form_asks_anything_about_a_person_it_should_not() -> None:
    for form in FORMS:
        haystack = " ".join(f.code + " " + f.label for f in form.fields).lower()
        for term in ("age", "birth", "gender", "caste", "religion", "marital"):
            assert not re.search(rf"\b{term}\w{{0,3}}\b", haystack), (
                f"{form.code} asks about {term!r}"
            )


@pytest.mark.parametrize(
    ("pattern", "good", "bad"),
    [
        (PAN_PATTERN, "AABCU9603R", "AABCU96031"),
        (GSTIN_PATTERN, "27AAPFU0939F1ZV", "27AAPFU0939F1XV"),
        (AISHE_PATTERN, "C-12345", "12345"),
        (INDIAN_MOBILE_PATTERN, "9876543210", "1234567890"),
    ],
)
def test_the_statutory_formats_accept_real_values_and_reject_near_misses(
    pattern: str, good: str, bad: str
) -> None:
    assert re.match(pattern, good)
    assert not re.match(pattern, bad)
