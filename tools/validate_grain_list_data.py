"""Validate the public Grain List dataset before deployment."""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_DATA = Path("data/organizations.json")
DEFAULT_CONFIG = Path("config/functions.json")
INTERNAL_FIELDS = {
    "record_id",
    "confidence",
    "notes",
    "proposed_updates",
    "extracted_fields",
}
PLACEHOLDER_EMAIL = re.compile(
    r"(?:example\.com|email@|yourname@|name@domain|test@)",
    re.IGNORECASE,
)
LOCATION_PRECISIONS = {"address", "organization", "place", "state"}


def valid_web_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def validate_payload(payload: dict, allowed_functions: set[str]) -> list[str]:
    issues: list[str] = []
    organizations = payload.get("organizations")
    if not isinstance(organizations, list):
        return ["organizations must be a list"]

    ids: set[str] = set()
    for index, organization in enumerate(organizations, start=1):
        label = organization.get("name") or f"row {index}"
        identifier = str(organization.get("id", ""))
        if not identifier or identifier in ids:
            issues.append(f"{label}: missing or duplicate public identifier")
        ids.add(identifier)
        if identifier.startswith("org-"):
            issues.append(f"{label}: internal record ID is exposed")

        leaked = INTERNAL_FIELDS.intersection(organization)
        if leaked:
            issues.append(f"{label}: internal fields exposed: {', '.join(sorted(leaked))}")
        if not str(organization.get("name", "")).strip():
            issues.append(f"row {index}: name is blank")

        for function in organization.get("functions", []):
            if function not in allowed_functions:
                issues.append(f"{label}: unsupported function '{function}'")

        for field in ("url",):
            value = str(organization.get(field, "")).strip()
            if value and not valid_web_url(value):
                issues.append(f"{label}: invalid {field} '{value}'")
        for source in organization.get("sources", []):
            if not valid_web_url(str(source)):
                issues.append(f"{label}: invalid source URL '{source}'")

        email = str(organization.get("email", "")).strip()
        if email and ("@" not in email or PLACEHOLDER_EMAIL.search(email)):
            issues.append(f"{label}: invalid or placeholder email '{email}'")

        location = organization.get("location")
        if location is None:
            issues.append(f"{label}: location is missing")
        else:
            try:
                latitude = float(location["lat"])
                longitude = float(location["lng"])
            except (KeyError, TypeError, ValueError):
                issues.append(f"{label}: invalid location")
            else:
                if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                    issues.append(f"{label}: location is outside valid coordinate bounds")
            precision = location.get("precision")
            if precision not in LOCATION_PRECISIONS:
                issues.append(f"{label}: invalid location precision '{precision}'")

    summary = payload.get("summary", {})
    mapped = sum(bool(row.get("location")) for row in organizations)
    verified = sum(row.get("status") == "Verified" for row in organizations)
    expected = {"total": len(organizations), "mapped": mapped, "verified": verified}
    for key, value in expected.items():
        if summary.get(key) != value:
            issues.append(f"summary.{key} is {summary.get(key)!r}; expected {value}")
    return issues


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    args = parser.parse_args()

    payload = json.loads(args.data.read_text(encoding="utf-8"))
    config = json.loads(args.config.read_text(encoding="utf-8"))
    allowed_functions = set(config["allowed_functions"])
    issues = validate_payload(payload, allowed_functions)
    if issues:
        print(f"Grain List validation found {len(issues)} issue(s):")
        for issue in issues:
            print(f"- {issue}")
        raise SystemExit(1)

    summary = payload["summary"]
    print(
        "Grain List data passed: "
        f"{summary['total']} organizations, {summary['mapped']} mapped"
    )


if __name__ == "__main__":
    main()
