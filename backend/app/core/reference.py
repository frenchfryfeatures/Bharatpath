"""Reference lists shared by more than one module's forms.

In `app.core` because the KYB form and the college form both name
`reference.INDIAN_STATES`, and `kyb` and `college` may not import each other.
`EMPLOYEE_COUNT_BANDS` is here for the same reason: the KYB form asks for it
and the employer's own profile keeps it.
Until this file existed, that options source resolved to nothing -- so every
state an employer picked would have been refused as "not an option".

**Codes are stable and stored; names are display text.** Never rename a code,
because rows already carry it. The codes are the familiar two-letter
abbreviations. They are chosen for stability, not claimed to be any particular
revision of ISO 3166-2:IN, which has itself renamed several (Odisha,
Chhattisgarh, Uttarakhand) -- exactly the kind of churn a stored code must not
follow.

A later verification step could cross-check the state against the first two
digits of a GSTIN, which encode the GST state code. That mapping is not here:
it is not needed to collect an address, and a wrong one would reject genuine
employers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True, slots=True)
class Region:
    code: str
    name: str
    union_territory: bool = False


#: The 28 states and 8 union territories, alphabetical by name.
INDIAN_STATES: Final[tuple[Region, ...]] = (
    Region("AN", "Andaman and Nicobar Islands", union_territory=True),
    Region("AP", "Andhra Pradesh"),
    Region("AR", "Arunachal Pradesh"),
    Region("AS", "Assam"),
    Region("BR", "Bihar"),
    Region("CH", "Chandigarh", union_territory=True),
    Region("CG", "Chhattisgarh"),
    Region("DH", "Dadra and Nagar Haveli and Daman and Diu", union_territory=True),
    Region("DL", "Delhi", union_territory=True),
    Region("GA", "Goa"),
    Region("GJ", "Gujarat"),
    Region("HR", "Haryana"),
    Region("HP", "Himachal Pradesh"),
    Region("JK", "Jammu and Kashmir", union_territory=True),
    Region("JH", "Jharkhand"),
    Region("KA", "Karnataka"),
    Region("KL", "Kerala"),
    Region("LA", "Ladakh", union_territory=True),
    Region("LD", "Lakshadweep", union_territory=True),
    Region("MP", "Madhya Pradesh"),
    Region("MH", "Maharashtra"),
    Region("MN", "Manipur"),
    Region("ML", "Meghalaya"),
    Region("MZ", "Mizoram"),
    Region("NL", "Nagaland"),
    Region("OD", "Odisha"),
    Region("PY", "Puducherry", union_territory=True),
    Region("PB", "Punjab"),
    Region("RJ", "Rajasthan"),
    Region("SK", "Sikkim"),
    Region("TN", "Tamil Nadu"),
    Region("TS", "Telangana"),
    Region("TR", "Tripura"),
    Region("UP", "Uttar Pradesh"),
    Region("UK", "Uttarakhand"),
    Region("WB", "West Bengal"),
)

INDIAN_STATE_CODES: Final[frozenset[str]] = frozenset(r.code for r in INDIAN_STATES)

#: Headcount bands, `(code, label)`. The KYB form still names this list
#: `kyb.EMPLOYEE_COUNT_BANDS` as its options source.
EMPLOYEE_COUNT_BANDS: Final[tuple[tuple[str, str], ...]] = (
    ("1_10", "1-10"),
    ("11_50", "11-50"),
    ("51_200", "51-200"),
    ("201_500", "201-500"),
    ("501_1000", "501-1,000"),
    ("1001_5000", "1,001-5,000"),
    ("5000_PLUS", "More than 5,000"),
)
EMPLOYEE_COUNT_BAND_CODES: Final[frozenset[str]] = frozenset(c for c, _ in EMPLOYEE_COUNT_BANDS)
