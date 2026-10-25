import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from import_highlighted_sheet import prepare

HEADERS = ["Category", "Function", "Name", "State", "Grains", "Address", "Phone", "Email", "URL", "Status", "Confidence", "Source", "Notes", "Record ID", "Operational Status"]


def row(name, identifier="", color="", **values):
    record = {"Name": name, "Record ID": identifier, "State": "CO", **values}
    return {"row": 2, "values": [record.get(key, "") for key in HEADERS], "colors": [color] * len(HEADERS)}


class HighlightedImportTests(unittest.TestCase):
    def test_red_overrides_active_and_new_rows_receive_ids(self):
        old = dict(zip(HEADERS, row("Old", "org-0001", **{"Operational Status": "Active"})["values"]))
        snapshot = {"records": [{"values": HEADERS}, row("Old", "org-0001", "#f4cccc", **{"Operational Status": "Active"}), row("New", color="#d9ead3")]}
        rows, _, report = prepare(snapshot, [old], {"organizations": []})
        self.assertEqual(rows[0]["Operational Status"], "Closed")
        self.assertEqual(rows[1]["Record ID"], "org-0002")
        self.assertEqual(rows[1]["Status"], "Partial")
        self.assertEqual(report["counts"], {"remove": 1, "addition": 1})

    def test_reentered_record_recovers_id_from_matching_contacts(self):
        old = dict(zip(HEADERS, row("Vertical Malt", "org-0001", Phone="701-203-3358", Email="info@verticalmalt.com", URL="https://verticalmalt.com", **{"Operational Status": "Active"})["values"]))
        snapshot = {"records": [{"values": HEADERS}, row("Veritcal Malt", color="#d9d2e9", Phone="701-203-3358", Email="info@verticalmalt.com")]}
        rows, _, _ = prepare(snapshot, [old], {"organizations": []})
        self.assertEqual(rows[0]["Record ID"], "org-0001")
        self.assertEqual(rows[0]["URL"], "https://verticalmalt.com")

    def test_active_records_cannot_disappear_silently(self):
        old = {"Record ID": "org-0001", "Name": "Existing", "State": "CO", "Operational Status": "Active"}
        with self.assertRaises(ValueError):
            prepare({"records": [{"values": HEADERS}]}, [old], {"organizations": []})

    def test_retained_green_highlight_does_not_create_another_record(self):
        snapshot = {"records": [{"values": HEADERS}, row("New Farm", color="#d9ead3")]}
        first, _, _ = prepare(snapshot, [], {"organizations": []})
        second, _, report = prepare(snapshot, first, {"organizations": []})
        self.assertEqual(first[0]["Record ID"], second[0]["Record ID"])
        self.assertNotIn("addition", report["counts"])
