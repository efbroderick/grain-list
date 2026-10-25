import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_grain_list_data import fallback_precision


class GeocodingPrecisionTests(unittest.TestCase):
    def test_road_matches_are_never_claimed_as_street_addresses(self):
        for kind in ("primary", "secondary", "tertiary", "unclassified", "residential"):
            self.assertEqual(fallback_precision("123 Main Street, Town, CA", {"result_type": kind}, "address"), "place")
        self.assertEqual(fallback_precision("123 Main Street, Town, CA", {"result_type": "house"}, "address"), "address")
