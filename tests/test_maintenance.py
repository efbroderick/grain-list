import csv
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_grain_list_data import cache_matches_row, organization_payload
from maintain_directory import REQUIRED, apply_exceptions, audit, changes_between, issue, check_links


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.row = {field: "" for field in REQUIRED}
        self.row.update({"Record ID": "org-test", "Name": "Example Mill", "State": "CO", "Function": "Retail Flour",
                         "Grains": "Rye", "Address": "100 Main Street, Denver, CO 80202", "URL": "https://examplemill.org",
                         "Source": "https://examplemill.org/products", "Status": "Verified", "Operational Status": "Active"})
        self.cache = {"org-test": {"address": self.row["Address"], "state": "CO", "name": "Example Mill", "latitude": 39.7, "longitude": -104.9, "precision": "address"}}

    def test_flags_missing_function_even_with_verified_status(self):
        self.row["Function"] = ""
        self.assertIn("missing_function", [i["Code"] for i in audit([self.row], {"Retail Flour"}, self.cache)])

    def test_blocks_conflicting_address_state(self):
        self.row["State"] = "KY"
        codes = [i["Code"] for i in audit([self.row], {"Retail Flour"}, self.cache)]
        self.assertIn("address_state_conflict", codes)
        self.assertIn("stale_coordinates", codes)
        self.assertFalse(cache_matches_row(self.row, self.cache["org-test"]))
        self.assertIsNone(organization_payload(self.row, self.cache)["location"])

    def test_does_not_treat_shared_city_as_duplicate(self):
        second = {**self.row, "Record ID": "org-other", "Name": "Other Mill", "URL": "https://othermill.org"}
        codes = [i["Code"] for i in audit([self.row, second], {"Retail Flour"}, self.cache)]
        self.assertNotIn("duplicate_name", codes)
        self.assertNotIn("duplicate_website", codes)

    def test_manual_lists_replace_exactly_in_the_diff(self):
        published = {"organizations": [organization_payload(self.row, self.cache)]}
        self.row["Function"] = "Grain Featured on Menu"
        self.row["Grains"] = "Hard Red Winter Wheat"
        changes = changes_between([self.row], published)
        functions = [i for i in changes if i["Field"] == "Function"]
        self.assertEqual(functions[0]["Before"], "Retail Flour")
        self.assertEqual(functions[0]["After"], "Grain Featured on Menu")

    def test_exception_cannot_hide_error_or_changed_evidence(self):
        warning = issue(self.row, "missing_function", "Function", "Blank")
        error = issue(self.row, "state", "State", "Bad", "error")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "exceptions.csv"
            with path.open("w", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=["Record ID", "Code", "Fingerprint", "Reason"])
                writer.writeheader()
                for i in (warning, error):
                    writer.writerow({k: i[k] for k in ("Record ID", "Code", "Fingerprint")} | {"Reason": "Reviewed"})
            result = apply_exceptions([warning, error], path)
            self.assertEqual(result[0]["Reviewed Exception"], "yes")
            self.assertEqual(result[1]["Reviewed Exception"], "")
            changed = issue({**self.row, "Source": "https://other.org"}, "missing_function", "Function", "Blank")
            self.assertEqual(apply_exceptions([changed], path)[0]["Reviewed Exception"], "")

    def test_blocked_publish_does_not_modify_the_published_file(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            source = folder / "source.csv"
            with source.open("w", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=REQUIRED)
                writer.writeheader()
                writer.writerow({**self.row, "Function": ""})
            published = folder / "published.json"
            original = json.dumps({"organizations": [organization_payload(self.row, self.cache)]})
            published.write_text(original)
            cache = folder / "cache.json"
            cache.write_text(json.dumps(self.cache))
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "tools/maintain_directory.py"),
                                     "--input", str(source), "--published", str(published), "--cache", str(cache),
                                     "--report-dir", str(folder / "report"), "--publish"], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(published.read_text(), original)
            self.assertTrue((folder / "report/review.html").exists())

    def test_successful_publication_preserves_snapshot_and_excludes_closed_record(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            source = folder / "source.csv"
            closed = {**self.row, "Record ID": "org-closed", "Name": "Closed Mill", "Operational Status": "Closed"}
            with source.open("w", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=REQUIRED)
                writer.writeheader()
                writer.writerows([self.row, closed])
            published = folder / "published.json"
            original = json.dumps({"organizations": []})
            published.write_text(original)
            cache = folder / "cache.json"
            cache.write_text(json.dumps(self.cache))
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "tools/maintain_directory.py"),
                                     "--input", str(source), "--published", str(published), "--cache", str(cache),
                                     "--report-dir", str(folder / "latest"), "--publish"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(published.read_text())["summary"]["total"], 1)
            releases = list((folder / "releases").iterdir())
            self.assertEqual(len(releases), 1)
            self.assertEqual((releases[0] / "previous.json").read_text(), original)
            self.assertTrue((releases[0] / "manifest.json").exists())
            self.assertTrue((releases[0] / "source.csv").exists())

    def test_website_checks_are_capped_and_resume_without_repeating_cached_urls(self):
        rows = [self.row, {**self.row, "Record ID": "org-other", "URL": "https://other.org"}]
        response = MagicMock()
        response.status_code = 200
        response.url = self.row["URL"]
        with tempfile.TemporaryDirectory() as temp, patch("maintain_directory.requests.get", return_value=response) as get:
            path = Path(temp) / "urls.json"
            first = check_links(rows, path, max_checks=1)
            self.assertEqual(get.call_count, 1)
            self.assertEqual(len(first), 1)
            response.url = rows[1]["URL"]
            second = check_links(rows, path, max_checks=1)
            self.assertEqual(get.call_count, 2)
            self.assertEqual(len(second), 2)

    def test_organization_name_change_invalidates_name_based_coordinates(self):
        cached = {**self.cache["org-test"], "precision": "organization"}
        self.assertTrue(cache_matches_row(self.row, cached))
        self.row["Name"] = "Other Organization"
        self.assertFalse(cache_matches_row(self.row, cached))


if __name__ == "__main__":
    unittest.main()
