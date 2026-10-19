"""Apply approved function aliases and remove legumes, preserving all map coordinates."""

import argparse
import csv
import json
from pathlib import Path

from standardize_directory import standardize_functions, standardize_grains


def clean(root):
    source = root / "data/publication_list.csv"
    with source.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        headers, rows = reader.fieldnames, list(reader)
    report = []
    for row in rows:
        for field, normalize in (("Function", standardize_functions), ("Grains", standardize_grains)):
            before = row.get(field, "")
            after = normalize(before)
            if before != after:
                report.append({"Record ID": row["Record ID"], "Name": row["Name"], "Field": field, "Before": before, "After": after})
                row[field] = after
    with source.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
    data = root / "data/organizations.json"
    payload = json.loads(data.read_text())
    for organization in payload["organizations"]:
        organization["functions"] = standardize_functions(", ".join(organization["functions"])).split(", ") if organization["functions"] else []
        grains = standardize_grains(", ".join(organization["grains"]))
        organization["grains"] = grains.split(", ") if grains else []
    data.write_text(json.dumps(payload, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    output = root / ".maintenance/taxonomy-changes.csv"
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=["Record ID", "Name", "Field", "Before", "After"])
        writer.writeheader()
        writer.writerows(report)
    print(f"Updated {len(report)} field values. Coordinates and organization IDs preserved. Report: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    clean(parser.parse_args().root)
