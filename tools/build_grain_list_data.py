"""Build the browser dataset for Grain List with free, cached geocoding."""

import argparse
import csv
import hashlib
import io
import json
import re
import time
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path

import requests


DEFAULT_INPUT = Path("data/publication_list.csv")
DEFAULT_OUTPUT = Path("data/organizations.json")
DEFAULT_CACHE = Path(".cache/grain_list_geocode_cache.json")
CENSUS_BATCH_ENDPOINT = (
    "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
)
NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "GrainList/1.0 (contact: hello@grain-list.aleeas.com)"
NOMINATIM_REQUEST_INTERVAL = 1.1
ADDRESS_PATTERN = re.compile(
    r"^(?P<street>.+),\s*(?P<city>[^,]+),\s*(?P<state>[A-Z]{2})"
    r"(?:\s+(?P<zip>\d{5})(?:-\d{4})?)?\s*$"
)
LOCALITY_PATTERN = re.compile(
    r",\s*(?P<city>[^,]+),\s*(?P<state>[A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$"
)
UNIT_PATTERN = re.compile(
    r"\s+(?:suite|ste\.?|unit|building|bldg\.?)\s*[A-Z0-9-]+(?=,|$)",
    re.IGNORECASE,
)
STREET_ABBREVIATIONS = {
    r"\bRd\.?\b": "Road",
    r"\bSt\.?\b": "Street",
    r"\bAve\.?\b": "Avenue",
    r"\bHwy\.?\b": "Highway",
    r"\bLn\.?\b": "Lane",
    r"\bDr\.?\b": "Drive",
    r"\bRte\.?\b": "Route",
}
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine",
    "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska",
    "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
STATE_CODES_BY_NAME = {name.casefold(): code for code, name in STATE_NAMES.items()}
STATE_CENTERS = {
    "AL": (32.806671, -86.791130), "AK": (61.370716, -152.404419),
    "AZ": (33.729759, -111.431221), "AR": (34.969704, -92.373123),
    "CA": (36.116203, -119.681564), "CO": (39.059811, -105.311104),
    "CT": (41.597782, -72.755371), "DE": (39.318523, -75.507141),
    "DC": (38.897438, -77.026817), "FL": (27.766279, -81.686783),
    "GA": (33.040619, -83.643074), "HI": (21.094318, -157.498337),
    "ID": (44.240459, -114.478828), "IL": (40.349457, -88.986137),
    "IN": (39.849426, -86.258278), "IA": (42.011539, -93.210526),
    "KS": (38.526600, -96.726486), "KY": (37.668140, -84.670067),
    "LA": (31.169546, -91.867805), "ME": (44.693947, -69.381927),
    "MD": (39.063946, -76.802101), "MA": (42.230171, -71.530106),
    "MI": (43.326618, -84.536095), "MN": (45.694454, -93.900192),
    "MS": (32.741646, -89.678696), "MO": (38.456085, -92.288368),
    "MT": (46.921925, -110.454353), "NE": (41.125370, -98.268082),
    "NV": (38.313515, -117.055374), "NH": (43.452492, -71.563896),
    "NJ": (40.298904, -74.521011), "NM": (34.840515, -106.248482),
    "NY": (42.165726, -74.948051), "NC": (35.630066, -79.806419),
    "ND": (47.528912, -99.784012), "OH": (40.388783, -82.764915),
    "OK": (35.565342, -96.928917), "OR": (44.572021, -122.070938),
    "PA": (40.590752, -77.209755), "RI": (41.680893, -71.511780),
    "SC": (33.856892, -80.945007), "SD": (44.299782, -99.438828),
    "TN": (35.747845, -86.692345), "TX": (31.054487, -97.563461),
    "UT": (40.150032, -111.862434), "VT": (44.045876, -72.710686),
    "VA": (37.769337, -78.169968), "WA": (47.400902, -121.490494),
    "WV": (38.491226, -80.954453), "WI": (44.268543, -89.616508),
    "WY": (42.755966, -107.302490),
}
PLACE_TYPES = {
    "state", "county", "city", "town", "village", "hamlet", "municipality", "road"
}


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


def cache_matches_row(row: dict, cached: dict) -> bool:
    if not cached or cached.get("address", "") != row.get("Address", "").strip():
        return False
    parsed = parse_address(cached.get("address", ""))
    cached_state = cached.get("state") or (parsed or {}).get("state")
    if cached_state != row.get("State", "").strip():
        return False
    if cached.get("precision") == "organization" and cached.get("name") != row.get("Name", "").strip():
        return False
    return True


def read_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_cache(path: Path, cache: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")


def census_batch_geocode(rows: list[dict], timeout: int = 120) -> dict[str, dict]:
    by_id = {row["Record ID"]: row for row in rows}
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
        matched = parse_address(result[4].strip())
        if result[0] not in by_id or not matched or matched["state"] != by_id[result[0]].get("State"):
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
            "precision": "address",
            "source": "U.S. Census Geocoder",
        }
    return results


def normalized_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


def normalized_address_query(address: str, state_code: str) -> str:
    value = UNIT_PATTERN.sub("", (address or "").strip())
    for pattern, replacement in STREET_ABBREVIATIONS.items():
        value = re.sub(pattern, replacement, value, flags=re.IGNORECASE)
    state_name = STATE_NAMES.get(state_code, state_code)
    value = re.sub(
        rf",\s*{re.escape(state_code)}\b",
        f", {state_name}",
        value,
        flags=re.IGNORECASE,
    )
    return f"{value}, USA"


def locality_query(address: str, state_code: str) -> str:
    match = LOCALITY_PATTERN.search((address or "").strip())
    if not match:
        return ""
    city = match.group("city").strip().strip('"')
    if re.search(r"\d", city):
        return ""
    return f"{city}, {STATE_NAMES.get(state_code, state_code)}, USA"


def result_state_code(result: dict) -> str:
    address = result.get("address") or {}
    for key, value in address.items():
        if key.startswith("ISO3166-2") and isinstance(value, str) and value.startswith("US-"):
            return value.removeprefix("US-").upper()
    state_name = str(address.get("state", "")).casefold()
    return STATE_CODES_BY_NAME.get(state_name, "")


def organization_name_matches(name: str, result: dict) -> bool:
    target = normalized_name(name)
    candidate = normalized_name(str(result.get("display_name", "")).split(",", 1)[0])
    if not target or not candidate:
        return False
    return target in candidate or candidate in target or SequenceMatcher(None, target, candidate).ratio() >= 0.72


def nominatim_search(
    query: str,
    expected_state: str,
    timeout: int,
    require_name: str = "",
) -> dict | None:
    response = requests.get(
        NOMINATIM_ENDPOINT,
        params={
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "countrycodes": "us",
            "limit": 5,
        },
        headers={"User-Agent": NOMINATIM_USER_AGENT},
        timeout=timeout,
    )
    response.raise_for_status()
    for result in response.json():
        if result_state_code(result) != expected_state:
            continue
        if require_name and not organization_name_matches(require_name, result):
            continue
        try:
            latitude = float(result["lat"])
            longitude = float(result["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        return {
            "latitude": latitude,
            "longitude": longitude,
            "matched_address": result.get("display_name", ""),
            "result_type": result.get("addresstype") or result.get("type") or "",
            "source": "OpenStreetMap Nominatim",
        }
    return None


def fallback_precision(address: str, result: dict, query_kind: str) -> str:
    result_type = str(result.get("result_type", "")).casefold()
    if query_kind == "organization":
        return "organization"
    if result_type == "state":
        return "state"
    if result_type in PLACE_TYPES or not re.search(r"\d", address or ""):
        return "place"
    return "address"


def state_center_result(state_code: str) -> dict | None:
    center = STATE_CENTERS.get(state_code)
    if not center:
        return None
    return {
        "latitude": center[0],
        "longitude": center[1],
        "matched_address": f"{STATE_NAMES[state_code]} (approximate)",
        "precision": "state",
        "source": "State center fallback",
    }


def nominatim_geocode_rows(
    rows: list[dict],
    cache: dict,
    timeout: int,
    request_interval: float = NOMINATIM_REQUEST_INTERVAL,
) -> dict:
    remaining = [
        row for row in rows
        if "latitude" not in cache.get(row["Record ID"], {})
    ]
    if not remaining:
        return cache

    print(
        f"Resolving {len(remaining)} Census misses with cached OpenStreetMap fallbacks..."
    )
    last_request_at = 0.0
    for index, row in enumerate(remaining, start=1):
        record_id = row["Record ID"]
        address = row.get("Address", "").strip()
        state_code = row.get("State", "").strip().upper()
        queries: list[tuple[str, str, str]] = []
        if address:
            queries.append((normalized_address_query(address, state_code), "address", ""))
            place_query = locality_query(address, state_code)
            if place_query:
                queries.append((place_query, "place", ""))
        queries.append(
            (
                f"{row.get('Name', '').strip()}, {STATE_NAMES.get(state_code, state_code)}, USA",
                "organization",
                row.get("Name", "").strip(),
            )
        )

        result = None
        seen_queries: set[str] = set()
        for query, query_kind, require_name in queries:
            if query in seen_queries:
                continue
            seen_queries.add(query)
            elapsed = time.monotonic() - last_request_at
            if elapsed < request_interval:
                time.sleep(request_interval - elapsed)
            try:
                candidate = nominatim_search(
                    query,
                    expected_state=state_code,
                    timeout=timeout,
                    require_name=require_name,
                )
            except requests.RequestException as error:
                print(f"  {row.get('Name', record_id)}: OpenStreetMap lookup failed ({error})")
                candidate = None
            last_request_at = time.monotonic()
            if candidate:
                result = {
                    **candidate,
                    "precision": fallback_precision(address, candidate, query_kind),
                    "query": query,
                }
                break

        if not result:
            result = state_center_result(state_code)
        cache[record_id] = {
            "address": address,
            "state": state_code,
            "name": row.get("Name", "").strip(),
            **(result or {"unmatched": True}),
        }
        if index % 25 == 0 or index == len(remaining):
            print(f"  Resolved {index}/{len(remaining)} remaining records")
    return cache


def geocode_rows(rows: list[dict], cache: dict, timeout: int) -> dict:
    candidates = []
    for row in rows:
        record_id = row["Record ID"]
        address = row.get("Address", "").strip()
        cached = cache.get(record_id)
        if cached and not cache_matches_row(row, cached):
            cache.pop(record_id)
            cached = None
        if cached and cache_matches_row(row, cached):
            cached.update({"state": row.get("State", "").strip(), "name": row.get("Name", "").strip()})
            continue
        if parse_address(address):
            candidates.append(row)

    if candidates:
        print(f"Sending {len(candidates)} addresses to the free Census batch geocoder...")
        results = census_batch_geocode(candidates, timeout=timeout)
        for row in candidates:
            record_id = row["Record ID"]
            address = row.get("Address", "").strip()
            result = results.get(record_id)
            cache[record_id] = {"address": address, "state": row.get("State", "").strip(), "name": row.get("Name", "").strip(), **(result or {"unmatched": True})}
    return nominatim_geocode_rows(rows, cache, timeout=timeout)


def organization_payload(row: dict, cache: dict) -> dict:
    record_id = row["Record ID"]
    location = cache.get(record_id, {})
    parsed_address = parse_address(row.get("Address", ""))
    coordinates = None
    if cache_matches_row(row, location) and "latitude" in location and "longitude" in location:
        coordinates = {
            "lat": location["latitude"],
            "lng": location["longitude"],
            "precision": location.get("precision", "address"),
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
