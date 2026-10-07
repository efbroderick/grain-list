"""Build the browser dataset for Grain List with free Census geocoding."""

import argparse
import csv
import hashlib
import io
import json
import re
from datetime import date
from pathlib import Path

import requests


DEFAULT_INPUT = Path("data/publication_list.csv")
DEFAULT_OUTPUT = Path("data/organizations.json")
DEFAULT_CACHE = Path(".cache/grain_list_geocode_cache.json")
CENSUS_BATCH_ENDPOINT = (
    "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
)
ADDRESS_PATTERN = re.compile(
    r"^(?P<street>.+),\s*(?P<city>[^,]+),\s*(?P<state>[A-Z]{2})"
    r"(?:\s+(?P<zip>\d{5})(?:-\d{4})?)?\s*$"
)


def split_values(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def public_identifier(record_id: str) -> str:
    """Return a stable browser key without publishing the internal record ID."""
    digest = hashlib.sha256(record_id.encode("utf-8")).hexdigest()[:16]
    return f"grain-{digest}"


def parse_address(address: str) -> dict | None:
    match = ADDRESS_PATTERN.match((address or "").strip())
    if not match or not re.search(r"\d", match.group("street")):
        return None
    return {
        "street": match.group("street").strip(),
        "city": match.group("city").strip().strip('"'),
        "state": match.group("state"),
        "zip": match.group("zip") or "",
    }


def read_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_cache(path: Path, cache: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")


def census_batch_geocode(rows: list[dict], timeout: int = 120) -> dict[str, dict]:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    for row in rows:
        parsed = parse_address(row.get("Address", ""))
        if parsed:
            writer.writerow(
                [
                    row["Record ID"],
                    parsed["street"],
                    parsed["city"],
                    parsed["state"],
                    parsed["zip"],
                ]
            )
    if not buffer.getvalue():
        return {}

    response = requests.post(
        CENSUS_BATCH_ENDPOINT,
        data={"benchmark": "Public_AR_Current"},
        files={"addressFile": ("grain-list-addresses.csv", buffer.getvalue(), "text/csv")},
        headers={"User-Agent": "grain-list/1.0"},
        timeout=timeout,
    )
    response.raise_for_status()

    results = {}
    for result in csv.reader(io.StringIO(response.text)):
        if len(result) < 6 or result[2].strip().casefold() != "match":
            continue
        coordinates = result[5].split(",")
        if len(coordinates) != 2:
            continue
        try:
            longitude, latitude = (float(value) for value in coordinates)
        except ValueError:
            continue
        results[result[0]] = {
            "latitude": latitude,
            "longitude": longitude,
            "matched_address": result[4].strip(),
            "match_type": result[3].strip(),
            "source": "U.S. Census Geocoder",
        }
    return results


def geocode_rows(rows: list[dict], cache: dict, timeout: int) -> dict:
    candidates = []
    for row in rows:
        record_id = row["Record ID"]
        address = row.get("Address", "").strip()
        cached = cache.get(record_id)
        if cached and cached.get("address") == address:
            continue
        if parse_address(address):
            candidates.append(row)

    if not candidates:
        return cache

    print(f"Sending {len(candidates)} addresses to the free Census batch geocoder...")
    results = census_batch_geocode(candidates, timeout=timeout)
    for row in candidates:
        record_id = row["Record ID"]
        address = row.get("Address", "").strip()
        result = results.get(record_id)
        cache[record_id] = {"address": address, **(result or {"unmatched": True})}
    return cache


def organization_payload(row: dict, cache: dict) -> dict:
    record_id = row["Record ID"]
    location = cache.get(record_id, {})
    parsed_address = parse_address(row.get("Address", ""))
    coordinates = None
    if "latitude" in location and "longitude" in location:
        coordinates = {
            "lat": location["latitude"],
            "lng": location["longitude"],
        }
    return {
        "id": public_identifier(record_id),
        "name": row.get("Name", ""),
        "category": row.get("Category", ""),
        "state": row.get("State", ""),
        "city": parsed_address["city"] if parsed_address else "",
        "functions": split_values(row.get("Function", "")),
        "grains": split_values(row.get("Grains", "")),
        "address": row.get("Address", ""),
        "phone": row.get("Phone", ""),
        "email": row.get("Email", ""),
        "url": row.get("URL", ""),
        "status": row.get("Status", ""),
        "sources": [part.strip() for part in row.get("Source", "").split(";") if part.strip()],
        "location": coordinates,
    }


def build_payload(rows: list[dict], cache: dict) -> dict:
    organizations = [organization_payload(row, cache) for row in rows]
    organizations.sort(key=lambda row: (row["name"].casefold(), row["state"]))
    return {
        "generated": date.today().isoformat(),
        "summary": {
            "total": len(organizations),
            "mapped": sum(bool(row["location"]) for row in organizations),
            "verified": sum(row["status"] == "Verified" for row in organizations),
        },
        "organizations": organizations,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--geocode", action="store_true")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    with args.input.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    cache = read_cache(args.cache)
    if args.geocode:
        cache = geocode_rows(rows, cache, timeout=args.timeout)
        write_cache(args.cache, cache)

    payload = build_payload(rows, cache)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Organizations written: {payload['summary']['total']}")
    print(f"Organizations mapped: {payload['summary']['mapped']}")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
