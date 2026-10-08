"""Formatting-only cleanup of a reviewed directory export; no network requests."""

import argparse
import csv
import re
from pathlib import Path


STREET_TYPES = {
    "st": "Street", "rd": "Road", "ln": "Lane", "hwy": "Highway",
    "blvd": "Boulevard", "ave": "Avenue", "av": "Avenue", "dr": "Drive",
    "ct": "Court", "cir": "Circle", "pkwy": "Parkway", "pl": "Place",
    "ter": "Terrace", "terr": "Terrace", "trl": "Trail", "rte": "Route",
    "tpke": "Turnpike", "expy": "Expressway", "fwy": "Freeway",
}
TOKEN = re.compile(r"\b(" + "|".join(STREET_TYPES) + r")\b\.?", re.I)
SUFFIX_TAIL = re.compile(
    r"^\s*(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\.?\s*)?"
    r"(?:(?:\#|suite\b|ste\b|unit\b|building\b|bldg\b|apt\b).*)?$", re.I,
)
FUNCTION_TYPOS = {"Grian Featured on Menu": "Grain Featured on Menu"}


def standardize_address(address):
    # Only numbered street components: never expand St. Louis or Dr. in a name.
    pieces = re.split(r"([,;\n])", address or "")
    for index in range(0, len(pieces), 2):
        component = pieces[index]
        if not re.match(r"^\s*(?:[NSEW]\s*)?\d+[A-Za-z]?(?:[-/]\d+)?\s+", component, re.I):
            continue
        component = re.sub(r"\bCR\.?\s+(?=\d)", "County Road ", component, flags=re.I)
        component = re.sub(r"\b(?:Co|Cty)\.?\s+(?=Road\b|Rd\b)", "County ", component, flags=re.I)
        def replace(match):
            key = match.group(1).casefold()
            tail = component[match.end():]
            route_prefix = key in {"rd", "hwy", "rte"} and re.match(r"\s+\d", tail)
            county_route = key in {"rd", "hwy"} and re.search(r"\bCounty\s+$", component[:match.start()], re.I)
            numbered_street = key == "st" and re.search(r"\b\d+(?:st|nd|rd|th)\s+$", component[:match.start()], re.I)
            if route_prefix or county_route or numbered_street or SUFFIX_TAIL.fullmatch(tail):
                return STREET_TYPES[key]
            return match.group(0)
        pieces[index] = TOKEN.sub(replace, component)
    return "".join(pieces)


def standardize_functions(value):
    functions = [FUNCTION_TYPOS.get(part.strip(), part.strip()) for part in (value or "").split(",") if part.strip()]
    return ", ".join(sorted(functions, key=str.casefold))


def standardize_rows(rows):
    result, changes = [], []
    for number, original in enumerate(rows, 2):
        row = dict(original)
        for field, normalize in (("Address", standardize_address), ("Function", standardize_functions)):
            before = row.get(field, "")
            after = normalize(before)
            if before != after:
                changes.append({"Row": number, "Record ID": row.get("Record ID", ""), "Name": row.get("Name", ""), "Field": field, "Before": before, "After": after})
                row[field] = after
        result.append(row)
    return result, changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--changes", type=Path, required=True)
    args = parser.parse_args()
    if args.input.resolve() in {args.output.resolve(), args.changes.resolve()} or args.output.resolve() == args.changes.resolve():
        parser.error("Input, output, and changes must be separate files.")
    with args.input.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        headers = reader.fieldnames or []
        if not {"Address", "Function", "Record ID", "Name"}.issubset(headers):
            parser.error("Missing required directory columns.")
        rows, changes = standardize_rows(list(reader))
    for path, records, columns in ((args.output, rows, headers), (args.changes, changes, ["Row", "Record ID", "Name", "Field", "Before", "After"])):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=columns)
            writer.writeheader()
            writer.writerows(records)
    print(f"Saved {len(rows)} records and {len(changes)} formatting changes. Source not overwritten.")


if __name__ == "__main__":
    main()
