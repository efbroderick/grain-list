import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from validate_grain_list_data import validate_payload


ALLOWED_FUNCTIONS = {"Grain Grower", "Retail Flour"}


def payload_with(organization: dict) -> dict:
    return {
        "summary": {
            "total": 1,
            "mapped": int(bool(organization.get("location"))),
            "verified": int(organization.get("status") == "Verified"),
        },
        "organizations": [organization],
    }


class ValidateGrainListDataTests(unittest.TestCase):
    def setUp(self):
        self.organization = {
            "id": "grain-abcd1234",
            "name": "Example Mill",
            "functions": ["Retail Flour"],
            "grains": ["Rye"],
            "email": "hello@examplemill.com",
            "url": "https://examplemill.com",
            "sources": ["https://examplemill.com/about"],
            "status": "Verified",
            "location": {"lat": 39.7, "lng": -104.9, "precision": "address"},
        }

    def test_accepts_public_record(self):
        self.assertEqual(
            validate_payload(payload_with(self.organization), ALLOWED_FUNCTIONS),
            [],
        )

    def test_rejects_internal_fields_and_ids(self):
        self.organization["id"] = "org-0001"
        self.organization["confidence"] = 0.9

        issues = validate_payload(payload_with(self.organization), ALLOWED_FUNCTIONS)

        self.assertTrue(any("internal record ID" in issue for issue in issues))
        self.assertTrue(any("internal fields" in issue for issue in issues))

    def test_rejects_unknown_function_and_bad_source(self):
        self.organization["functions"] = ["Mystery Function"]
        self.organization["sources"] = ["not-a-url"]

        issues = validate_payload(payload_with(self.organization), ALLOWED_FUNCTIONS)

        self.assertTrue(any("unsupported function" in issue for issue in issues))
        self.assertTrue(any("invalid source URL" in issue for issue in issues))

    def test_rejects_a_record_without_a_map_location(self):
        self.organization["location"] = None

        issues = validate_payload(payload_with(self.organization), ALLOWED_FUNCTIONS)

        self.assertTrue(any("location is missing" in issue for issue in issues))

    def test_rejects_unknown_location_precision(self):
        self.organization["location"]["precision"] = "guess"

        issues = validate_payload(payload_with(self.organization), ALLOWED_FUNCTIONS)

        self.assertTrue(any("invalid location precision" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
