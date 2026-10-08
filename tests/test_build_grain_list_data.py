import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from build_grain_list_data import (
    build_payload,
    normalized_address_query,
    organization_name_matches,
    parse_address,
    public_identifier,
    state_center_result,
)


class BuildGrainListDataTests(unittest.TestCase):
    def test_parses_numbered_address_with_zip(self):
        result = parse_address("1875 Lawrence Street Suite 1200, Denver, CO 80202")

        self.assertEqual(result["street"], "1875 Lawrence Street Suite 1200")
        self.assertEqual(result["city"], "Denver")
        self.assertEqual(result["state"], "CO")
        self.assertEqual(result["zip"], "80202")

    def test_rejects_city_state_only_location(self):
        self.assertIsNone(parse_address("Denver, CO"))

    def test_builds_browser_safe_public_payload(self):
        rows = [
            {
                "Record ID": "org-001",
                "Name": "Example Mill",
                "Category": "Mill",
                "State": "CO",
                "Function": "Retail Flour, Grain Processor",
                "Grains": "Rye, Hard Red Winter Wheat",
                "Address": "100 Main Street, Denver, CO 80202",
                "Phone": "303-555-0100",
                "Email": "hello@example.com",
                "URL": "https://example.com",
                "Status": "Verified",
                "Source": "https://example.com; https://example.com/products",
                "Confidence": "0.9",
                "Notes": "Internal note",
            }
        ]
        cache = {
            "org-001": {
                "address": rows[0]["Address"],
                "latitude": 39.74,
                "longitude": -104.99,
                "precision": "address",
            }
        }

        payload = build_payload(rows, cache)
        organization = payload["organizations"][0]

        self.assertEqual(organization["id"], public_identifier("org-001"))
        self.assertNotEqual(organization["id"], "org-001")
        self.assertEqual(organization["functions"], ["Retail Flour", "Grain Processor"])
        self.assertEqual(organization["grains"], ["Rye", "Hard Red Winter Wheat"])
        self.assertEqual(
            organization["location"],
            {"lat": 39.74, "lng": -104.99, "precision": "address"},
        )
        self.assertNotIn("Confidence", organization)
        self.assertNotIn("Notes", organization)

    def test_accepts_a_close_organization_name_match(self):
        result = {"display_name": "Barton Springs Mill, Dripping Springs, Texas"}

        self.assertTrue(organization_name_matches("Barton Springs Mill", result))
        self.assertFalse(organization_name_matches("Different Bakery", result))

    def test_state_center_fallback_is_marked_approximate(self):
        result = state_center_result("CO")

        self.assertEqual(result["precision"], "state")
        self.assertIn("approximate", result["matched_address"])

    def test_normalizes_an_address_for_openstreetmap(self):
        query = normalized_address_query(
            "16604 Fitzhugh Rd Unit B, Dripping Springs, TX 78620",
            "TX",
        )

        self.assertEqual(
            query,
            "16604 Fitzhugh Road, Dripping Springs, Texas 78620, USA",
        )


if __name__ == "__main__":
    unittest.main()
