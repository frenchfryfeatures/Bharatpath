"""Create the seed CSV from the supplied explorer's embedded data, without executing it."""

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data/education_taxonomy.csv",
    )
    args = parser.parse_args()
    source = args.source.read_bytes()
    html = source.decode("utf8")
    groups = {
        key: json.loads(value)
        for key, value in re.findall(
            r'(\w+):("(?:[^"\\]|\\.)*")', html.split("const G={", 1)[1].split("const Q=", 1)[0]
        )
    }
    qualifications = json.JSONDecoder().raw_decode(html.split("const Q=", 1)[1].lstrip())[0]
    rows = []
    for qualification, courses in qualifications:
        for entry in courses.split(";"):
            course, values = entry.split("=", 1)
            specialties = (
                ["General / Not applicable"]
                if values == "-"
                else [
                    name
                    for token in values.split(",")
                    for name in (groups[token[1:]].split(",") if token.startswith("@") else [token])
                ]
            )
            rows.extend((qualification, course, specialty) for specialty in specialties)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(["Highest Qualification", "Course", "Specialization"])
        writer.writerows(rows)
    counts = [
        len({q for q, c, s in rows}),
        len({(q, c) for q, c, s in rows}),
        len({s for q, c, s in rows}),
        len(set(rows)),
    ]
    args.output.with_suffix(".source.json").write_text(
        json.dumps(
            {
                "source": args.source.name,
                "sha256": hashlib.sha256(source).hexdigest(),
                "counts": counts,
            },
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    print(
        dict(
            zip(
                [
                    "qualifications",
                    "courses",
                    "unique_specializations",
                    "course_specialization_links",
                ],
                counts,
                strict=True,
            )
        )
    )


if __name__ == "__main__":
    main()
