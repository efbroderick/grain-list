import hashlib
import json
import sys
import unittest
import tempfile
import csv
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_grain_list_data import row_public_identifier, sheet_coordinates, build_payload, geocode_rows
from maintain_directory import read_source, DEFAULT_SHEET


class AdminSheetCoordinatesTests(unittest.TestCase):
    def test_current_listings_export_keeps_public_ids_and_sources(self):
        identifier = "grain-75d6e8928a8b6a4b"
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "current.csv"
            with path.open("w", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=["Name", "Category", "State", "City", "Function", "Grains", "Address", "Phone", "Email", "Website", "Grain List Profile", "Sources", "Record ID"])
                writer.writeheader()
                writer.writerow({"Name": "Vertical Malt", "State": "MN", "Function": "Grain Grower", "Sources": "https://www.verticalmalt.com/contact\nhttps://www.verticalmalt.com/", "Website": "https://www.verticalmalt.com/", "Record ID": identifier})
            rows, _ = read_source(path)
        record = build_payload(rows, {})["organizations"][0]
        self.assertEqual(record["id"], identifier)
        self.assertEqual(record["url"], "https://www.verticalmalt.com/")
        self.assertEqual(len(record["sources"]), 2)
        self.assertEqual(rows[0]["Operational Status"], "Active")
        self.assertIn("1zhNRetv5gNYuaQtlZ8hxsW7GBdX7VpMbSN9boXkuYT8", DEFAULT_SHEET)

    def row(self):
        row = {"Record ID": "org-001", "Public ID": "grain-1234567890abcdef", "Name": "Farm", "State": "CO", "Address": "10 Main Street, Denver, CO 80202", "City": "Denver", "Latitude": "39.74", "Longitude": "-104.99", "Location Precision": "address"}
        row["Map Fingerprint"] = hashlib.sha256(json.dumps(["10 main street denver co 80202", "CO", ""], separators=(",", ":")).encode()).hexdigest()
        return row

    def test_existing_public_binding_survives_bulk_sheet_exports(self):
        row = self.row()
        self.assertEqual(row_public_identifier(row), row["Public ID"])
        self.assertEqual(build_payload([row], {})["organizations"][0]["id"], row["Public ID"])
        with self.assertRaises(ValueError):
            row_public_identifier({**row, "Public ID": "org-private"})

    def test_confirmed_sheet_point_survives_without_a_private_local_cache(self):
        row = self.row()
        self.assertEqual(sheet_coordinates(row), {"lat": 39.74, "lng": -104.99, "precision": "address"})
        self.assertEqual(build_payload([row], {})["organizations"][0]["location"]["lat"], 39.74)

    def test_changed_address_or_state_invalidates_confirmation(self):
        row = self.row()
        self.assertIsNone(sheet_coordinates({**row, "Address": "11 Main Street, Denver, CO 80202"}))
        self.assertIsNone(sheet_coordinates({**row, "State": "KY"}))
        self.assertIsNone(sheet_coordinates({**row, "Latitude": "nan"}))

    def test_street_suffix_formatting_preserves_confirmed_point(self):
        row = self.row()
        self.assertIsNotNone(sheet_coordinates({**row, "Address": "10 Main St., Denver, CO 80202"}))

    def test_confirmed_points_do_not_call_external_geocoders(self):
        row = self.row()
        with patch("build_grain_list_data.census_batch_geocode") as census, patch("build_grain_list_data.nominatim_search") as osm:
            cache = geocode_rows([row], {}, timeout=1)
            self.assertEqual(cache["org-001"]["latitude"], 39.74)
            census.assert_not_called()
            osm.assert_not_called()


if __name__ == "__main__":
    unittest.main()
