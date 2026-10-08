import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from standardize_directory import standardize_address, standardize_functions, standardize_rows


class StandardizeTests(unittest.TestCase):
    def test_street_types_and_units(self):
        for before, after in (("11045 War Eagle Rd.", "11045 War Eagle Road"), ("5215 Industrial Dr S", "5215 Industrial Drive S"), ("2280 Ivy St Ste 130", "2280 Ivy Street Ste 130"), ("990 S. Arroyo Pkwy #1", "990 S. Arroyo Parkway #1"), ("11356 Rd. 5 1/2", "11356 Road 5 1/2")):
            self.assertEqual(standardize_address(before + ", Town, CA 90001"), after + ", Town, CA 90001")

    def test_preserves_saint_doctor_and_localities(self):
        self.assertEqual(standardize_address("123 St. Charles St., St. Louis, MO 63101"), "123 St. Charles Street, St. Louis, MO 63101")
        self.assertEqual(standardize_address("10 Dr. Martin Luther King Blvd, St. Paul, MN 55101"), "10 Dr. Martin Luther King Boulevard, St. Paul, MN 55101")
        self.assertEqual(standardize_address("St. Louis, MO"), "St. Louis, MO")

    def test_route_prefix_and_idempotence(self):
        address = "101 Highway 6, Town, CO 80000; 25 County Rd 9 W, Town, CO 80000"
        result = standardize_address(address)
        self.assertEqual(result, address.replace("Rd", "Road"))
        self.assertEqual(standardize_address(result), result)

    def test_function_order_without_losing_values(self):
        self.assertEqual(standardize_functions("Wholesale Flour, Grain Processor, Retail Flour"), "Grain Processor, Retail Flour, Wholesale Flour")
        self.assertEqual(standardize_functions("Grian Featured on Menu, Grain User"), "Grain Featured on Menu, Grain User")

    def test_rural_and_missing_comma_addresses(self):
        self.assertEqual(standardize_address("2064 CR 12 S, Alamosa, CO 81101"), "2064 County Road 12 S, Alamosa, CO 81101")
        self.assertEqual(standardize_address("108 Co Road 105, Salida, CO"), "108 County Road 105, Salida, CO")
        self.assertEqual(standardize_address("W2363 County Rd D, Nelson, WI"), "W2363 County Road D, Nelson, WI")
        self.assertEqual(standardize_address("N71 W34080 County Rd K, Oconomowoc, WI"), "N71 W34080 County Road K, Oconomowoc, WI")
        self.assertEqual(standardize_address("410 125th St Amery, WI 54001"), "410 125th Street Amery, WI 54001")

    def test_other_fields_unchanged(self):
        original = {"Record ID": "org-1", "Name": "Test", "Address": "1 Main St, Town, CO 80000", "Function": "Grain User", "Grains": "Hard Red Wheat", "Source": "https://example.org"}
        rows, changes = standardize_rows([original])
        self.assertEqual(rows[0]["Grains"], original["Grains"])
        self.assertEqual(rows[0]["Source"], original["Source"])
        self.assertEqual(original["Address"], "1 Main St, Town, CO 80000")
        self.assertEqual(changes[0]["Row"], 2)
