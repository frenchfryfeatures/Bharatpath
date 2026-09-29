"""The starter search-filter catalogue: skills and cities an employer picks from.

**Ours, not the client's** -- written 2026-09-24 so the filter panel is not
empty on a fresh database, and `FILTER_CATALOGUE_VERSION` says so; a test holds
the prefix. Staff own the live list through `/admin/search-filters`, and
`scripts/seed_filter_options.py` writes these rows only where no option with
the same key exists, so a seed never overwrites a change made in the console.

Aliases are the spellings a CV or a candidate is likely to use instead.
Choosing an option searches every one of them, so an alias is a claim that
the two spellings mean the same thing -- "Excel" for "MS Excel" is; "Java" for
"JavaScript" is not.

Pure data. Nothing here reaches scoring.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

FILTER_CATALOGUE_VERSION: Final = "placeholder-2026-09-24"


@dataclass(frozen=True, slots=True)
class SeedOption:
    label: str
    aliases: tuple[str, ...] = ()
    state_code: str | None = None
    featured: bool = False


def _skill(label: str, *aliases: str, featured: bool = False) -> SeedOption:
    return SeedOption(label, aliases, None, featured)


def _city(label: str, state: str, *aliases: str, featured: bool = False) -> SeedOption:
    return SeedOption(label, aliases, state, featured)


SKILLS: Final[tuple[SeedOption, ...]] = (
    # Featured: the chips the filter panel shows before anything is typed.
    _skill("Warehouse Operations", "warehouse ops", "warehousing", featured=True),
    _skill("Quality Inspection", "quality inspector", "qc inspection", featured=True),
    _skill("Forklift Operation", "forklift certified", "forklift driving", featured=True),
    _skill("Inventory Management", "inventory mgmt", "stock management", featured=True),
    _skill("Safety Compliance", "workplace safety", "ehs", featured=True),
    _skill("Team Supervision", "supervision", "team handling", featured=True),
    _skill("Basic English", "spoken english", "english communication", featured=True),
    _skill("Hindi Typing", "hindi data entry", featured=True),
    # Operations, manufacturing and trades
    _skill("Quality Control", "qc"),
    _skill("Quality Assurance", "qa"),
    _skill("Packing", "packaging"),
    _skill("Loading and Unloading", "loading unloading"),
    _skill("Logistics", "supply chain"),
    _skill("Dispatch", "dispatch management"),
    _skill("Machine Operation", "machine operator"),
    _skill("CNC Operation", "cnc", "cnc operator", "cnc programming"),
    _skill("Lathe Operation", "lathe", "turner"),
    _skill("Welding", "welder", "arc welding", "mig welding", "tig welding"),
    _skill("Fitting", "fitter"),
    _skill("Electrical Wiring", "electrician", "wiring"),
    _skill("Plumbing", "plumber"),
    _skill("Carpentry", "carpenter"),
    _skill("Painting", "painter"),
    _skill("Maintenance", "preventive maintenance", "machine maintenance"),
    _skill("Assembly", "assembly line"),
    _skill("Production Planning", "ppc"),
    _skill("5S", "5s methodology"),
    _skill("Kaizen"),
    _skill("Lean Manufacturing", "lean"),
    _skill("Six Sigma"),
    _skill("ISO 9001", "iso 9001:2015"),
    _skill("AutoCAD", "auto cad"),
    _skill("Driving", "driver", "light motor vehicle", "lmv"),
    _skill("Heavy Vehicle Driving", "hmv", "heavy motor vehicle"),
    _skill("Security Guard", "security", "security services"),
    _skill("Housekeeping"),
    _skill("Cooking", "cook", "chef"),
    # Office and general
    _skill("MS Excel", "excel", "microsoft excel", "advanced excel"),
    _skill("MS Word", "word", "microsoft word"),
    _skill("MS PowerPoint", "powerpoint", "microsoft powerpoint"),
    _skill("MS Office", "microsoft office"),
    _skill("Google Sheets"),
    _skill("Tally", "tally erp", "tally erp 9", "tally prime"),
    _skill("SAP"),
    _skill("Data Entry"),
    _skill("Typing", "english typing"),
    _skill("Accounting", "accounts", "bookkeeping"),
    _skill("GST", "gst filing", "gst returns"),
    _skill("Payroll", "payroll processing"),
    _skill("Documentation", "record keeping"),
    _skill("Customer Service", "customer support", "customer care"),
    _skill("Telecalling", "tele calling", "telesales"),
    _skill("Sales", "field sales", "direct sales"),
    _skill("Retail Sales", "counter sales", "store sales"),
    _skill("Cashier", "billing", "cash handling"),
    _skill("Front Office", "receptionist", "reception"),
    _skill("Communication", "communication skills"),
    _skill("Teamwork", "team work"),
    _skill("Leadership"),
    _skill("Problem Solving"),
    _skill("Time Management"),
    # Languages
    _skill("Hindi", "spoken hindi"),
    _skill("Marathi"),
    _skill("Bengali", "bangla"),
    _skill("Kannada"),
    _skill("Punjabi"),
    _skill("Tamil"),
    _skill("Telugu"),
    _skill("Gujarati"),
    # Software and data
    _skill("Python"),
    _skill("Java"),
    _skill("JavaScript", "js"),
    _skill("TypeScript", "ts"),
    _skill("SQL", "mysql", "postgresql", "postgres"),
    _skill("HTML", "html5"),
    _skill("CSS", "css3"),
    _skill("React", "react.js", "reactjs"),
    _skill("Node.js", "node", "nodejs"),
    _skill("Django"),
    _skill("Spring Boot", "spring"),
    _skill("Android Development", "android"),
    _skill("Flutter"),
    _skill("Power BI", "powerbi"),
    _skill("Data Analysis", "data analytics"),
    _skill("Machine Learning", "ml"),
    _skill("Git", "github"),
    _skill("AWS", "amazon web services"),
    _skill("Linux"),
    _skill("Computer Hardware", "hardware and networking", "networking"),
)

CITIES: Final[tuple[SeedOption, ...]] = (
    # Maharashtra first: the client's launch region.
    _city("Pune", "MH", "Poona", featured=True),
    _city("Mumbai", "MH", "Bombay", featured=True),
    _city("Nashik", "MH", "Nasik", featured=True),
    _city("Aurangabad", "MH", "Chhatrapati Sambhajinagar", "Sambhajinagar", featured=True),
    _city("Nagpur", "MH", featured=True),
    _city("Thane", "MH"),
    _city("Navi Mumbai", "MH", "New Bombay"),
    _city("Pimpri-Chinchwad", "MH", "Pimpri", "Chinchwad"),
    _city("Kolhapur", "MH"),
    _city("Solapur", "MH", "Sholapur"),
    _city("Satara", "MH"),
    _city("Sangli", "MH"),
    _city("Ahmednagar", "MH", "Ahilyanagar"),
    _city("Jalgaon", "MH"),
    _city("Amravati", "MH"),
    _city("Nanded", "MH"),
    _city("Latur", "MH"),
    # Elsewhere: state capitals and the large industrial cities.
    _city("Bengaluru", "KA", "Bangalore", featured=True),
    _city("Mysuru", "KA", "Mysore"),
    _city("Mangaluru", "KA", "Mangalore"),
    _city("Hubballi", "KA", "Hubli"),
    _city("Belagavi", "KA", "Belgaum"),
    _city("New Delhi", "DL", "Delhi", featured=True),
    _city("Gurugram", "HR", "Gurgaon"),
    _city("Faridabad", "HR"),
    _city("Noida", "UP", "Gautam Buddh Nagar"),
    _city("Ghaziabad", "UP"),
    _city("Lucknow", "UP"),
    _city("Kanpur", "UP", "Cawnpore"),
    _city("Varanasi", "UP", "Banaras", "Benares"),
    _city("Prayagraj", "UP", "Allahabad"),
    _city("Agra", "UP"),
    _city("Kolkata", "WB", "Calcutta", featured=True),
    _city("Howrah", "WB"),
    _city("Durgapur", "WB"),
    _city("Siliguri", "WB"),
    _city("Chennai", "TN", "Madras", featured=True),
    _city("Coimbatore", "TN", "Kovai"),
    _city("Madurai", "TN"),
    _city("Hyderabad", "TS", featured=True),
    _city("Visakhapatnam", "AP", "Vizag"),
    _city("Vijayawada", "AP", "Bezawada"),
    _city("Ahmedabad", "GJ", "Amdavad", featured=True),
    _city("Surat", "GJ"),
    _city("Vadodara", "GJ", "Baroda"),
    _city("Rajkot", "GJ"),
    _city("Jaipur", "RJ"),
    _city("Jodhpur", "RJ"),
    _city("Indore", "MP"),
    _city("Bhopal", "MP"),
    _city("Chandigarh", "CH"),
    _city("Ludhiana", "PB"),
    _city("Amritsar", "PB"),
    _city("Jalandhar", "PB", "Jullundur"),
    _city("Mohali", "PB", "Sahibzada Ajit Singh Nagar", "SAS Nagar"),
    _city("Patna", "BR"),
    _city("Ranchi", "JH"),
    _city("Jamshedpur", "JH", "Tatanagar"),
    _city("Bhubaneswar", "OD"),
    _city("Raipur", "CG"),
    _city("Guwahati", "AS", "Gauhati"),
    _city("Dehradun", "UK"),
    _city("Thiruvananthapuram", "KL", "Trivandrum"),
    _city("Kochi", "KL", "Cochin"),
    _city("Kozhikode", "KL", "Calicut"),
    _city("Panaji", "GA", "Panjim"),
    _city("Puducherry", "PY", "Pondicherry"),
)
