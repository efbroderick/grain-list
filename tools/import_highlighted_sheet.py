"""Prepare a read-only Sheets snapshot for publication, preserving stable identities."""

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

from build_grain_list_data import public_identifier
from maintain_directory import changes_between, write_csv
from standardize_directory import standardize_rows

COLORS = {"#d9ead3": "addition", "#f4cccc": "remove", "#d9d2e9": "update"}


def normalized(value):
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def prepare(snapshot, previous_rows, published, overrides=None):
    headers = snapshot["records"][0]["values"]
    previous = {row["Record ID"]: row for row in previous_rows}
    next_id = max((int(value.split("-")[-1]) for value in previous if re.fullmatch(r"org-\d+", value)), default=0)
    rows, actions, seen = [], [], set()
    for record in snapshot["records"][1:]:
        row = dict(zip(headers, record["values"]))
        if not row.get("Name", "").strip():
            continue
        row = {key: value.strip() for key, value in row.items()}
        row.update((overrides or {}).get(str(record["row"]), {}))
        action = COLORS.get(record["colors"][2], "unchanged")
        identifier = row.get("Record ID", "")
        recovered = False
        if not identifier:
            matches = []
            for old in previous_rows:
                same_name = normalized(old["Name"]) == normalized(row["Name"]) and old["State"] == row["State"]
                same_contact = bool(row.get("Email") and row.get("Phone") and row["Email"].casefold() == old.get("Email", "").casefold() and re.sub(r"\D", "", row["Phone"]) == re.sub(r"\D", "", old.get("Phone", "")))
                if same_name or same_contact:
                    matches.append(old)
            if len(matches) > 1:
                raise ValueError(f"Ambiguous identity at source row {record['row']}: {row['Name']}")
            if matches:
                identifier = matches[0]["Record ID"]
                # Re-entered rows can lose metadata; retain known values until explicitly replaced.
                row = {**matches[0], **{key: value for key, value in row.items() if value}}
                recovered = True
                if action == "addition":
                    action = "update"
            else:
                next_id += 1
                identifier = f"org-{next_id:04d}"
                if action != "remove":
                    action = "addition"
        if identifier in seen:
            raise ValueError(f"Duplicate Record ID {identifier}")
        seen.add(identifier)
        row["Record ID"] = identifier
        if action == "remove":
            row["Operational Status"] = "Closed"
        elif not row.get("Operational Status"):
            row["Operational Status"] = "Active"
        if identifier not in previous:
            row["Status"] = row.get("Status") or "Partial"
            if not row.get("Source") and row.get("URL"):
                row["Source"] = row["URL"]
        rows.append(row)
        actions.append({"Sheet Row": record["row"], "Record ID": identifier, "Name": row["Name"], "Action": action, "Recovered ID": recovered})
    missing = set(previous) - seen
    active_missing = {identifier for identifier in missing if previous[identifier].get("Operational Status", "").casefold() == "active"}
    if active_missing:
        raise ValueError(f"Previously active IDs absent without a highlighted removal: {sorted(active_missing)}")
    rows.extend(previous[identifier] for identifier in sorted(missing))
    rows, formatting = standardize_rows(rows)
    return rows, headers, {"actions": actions, "formatting": formatting, "changes": changes_between(rows, published), "counts": dict(Counter(item["Action"] for item in actions))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--published", type=Path, required=True)
    parser.add_argument("--overrides", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with args.previous.open(newline="", encoding="utf-8-sig") as file:
        previous = list(csv.DictReader(file))
    rows, headers, report = prepare(json.loads(args.snapshot.read_text()), previous, json.loads(args.published.read_text()), json.loads(args.overrides.read_text()) if args.overrides else {})
    args.output.mkdir(parents=True, exist_ok=True)
    write_csv(args.output / "source.csv", rows, headers)
    write_csv(args.output / "actions.csv", report["actions"], ["Sheet Row", "Record ID", "Name", "Action", "Recovered ID"])
    (args.output / "import-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"source_records": len(rows), "active": sum(row["Operational Status"].casefold() == "active" for row in rows), "counts": report["counts"], "changes": dict(Counter(item["Type"] for item in report["changes"]))}, indent=2))


if __name__ == "__main__":
    main()
