PYTHON ?= .venv/bin/python

.PHONY: setup test validate data geocode serve

setup:
	python3.12 -m venv .venv
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) -m unittest discover -s tests
	node --check app.js

validate:
	$(PYTHON) tools/validate_grain_list_data.py

data:
	$(PYTHON) tools/build_grain_list_data.py
	$(PYTHON) tools/validate_grain_list_data.py

geocode:
	$(PYTHON) tools/build_grain_list_data.py --geocode
	$(PYTHON) tools/validate_grain_list_data.py

serve:
	$(PYTHON) -m http.server 4173
